//! Sealed Vault: backs each company's confidential payroll token 1:1 with USDC.
//!
//! USDC can't get Token-2022's confidential transfer extension, and a mint's auditor key is
//! per mint, so each company pays its team in its own confidential token. This program makes that
//! token as good as USDC:
//!
//! - `init_company` registers a company token whose mint authority the company handed to this
//!   program, with an empty supply, and creates the program-owned USDC vault that backs it.
//! - `wrap` takes USDC into the vault and mints the same amount of company tokens.
//! - `unwrap` burns company tokens and releases the same amount of USDC.
//!
//! Invariant, checked at the end of every instruction: company token supply == USDC in the vault.
//! Nobody else can mint the company token, so the invariant can't be broken from outside.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program_option::COption;
use anchor_spl::token_2022::ID as TOKEN_2022_PROGRAM_ID;
use anchor_spl::token_interface::{
    self, BurnChecked, Mint, MintTo, TokenAccount, TokenInterface, TransferChecked,
};

declare_id!("CTfg335Wow4yDCZGizkDnFk3SCT2GChkNsZVicTgbffm");

pub const COMPANY_SEED: &[u8] = b"company";
pub const VAULT_SEED: &[u8] = b"usdc_vault";

#[program]
pub mod sealed_vault {
    use super::*;

    /// Registers a company token. Before calling this, the company creates the Token-2022 mint
    /// (with its confidential transfer extension, auditor key and approval policy) and sets its
    /// mint authority to the company PDA, so only `wrap` can ever mint it.
    pub fn init_company(ctx: Context<InitCompany>) -> Result<()> {
        let company = &mut ctx.accounts.company;
        company.admin = ctx.accounts.admin.key();
        company.company_mint = ctx.accounts.company_mint.key();
        company.usdc_mint = ctx.accounts.usdc_mint.key();
        company.usdc_vault = ctx.accounts.usdc_vault.key();
        company.bump = ctx.bumps.company;
        company.vault_bump = ctx.bumps.usdc_vault;
        emit!(CompanyRegistered {
            company: company.key(),
            company_mint: company.company_mint,
            usdc_mint: company.usdc_mint,
        });
        Ok(())
    }

    /// Deposits `amount` USDC into the vault and mints `amount` company tokens to `recipient_token`.
    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let accounts = ctx.accounts;

        token_interface::transfer_checked(
            CpiContext::new(
                accounts.usdc_token_program.key(),
                TransferChecked {
                    from: accounts.depositor_usdc.to_account_info(),
                    mint: accounts.usdc_mint.to_account_info(),
                    to: accounts.usdc_vault.to_account_info(),
                    authority: accounts.depositor.to_account_info(),
                },
            ),
            amount,
            accounts.usdc_mint.decimals,
        )?;

        let company_mint_key = accounts.company_mint.key();
        let seeds: &[&[u8]] = &[COMPANY_SEED, company_mint_key.as_ref(), &[accounts.company.bump]];
        token_interface::mint_to(
            CpiContext::new_with_signer(
                accounts.company_token_program.key(),
                MintTo {
                    mint: accounts.company_mint.to_account_info(),
                    to: accounts.recipient_token.to_account_info(),
                    authority: accounts.company.to_account_info(),
                },
                &[seeds],
            ),
            amount,
        )?;

        check_backing(&mut accounts.company_mint, &mut accounts.usdc_vault)
    }

    /// Burns `amount` company tokens from the holder's public balance and releases `amount` USDC
    /// to `recipient_usdc`. Confidential balances must be withdrawn to the public balance first.
    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        require!(amount > 0, VaultError::ZeroAmount);
        let accounts = ctx.accounts;

        token_interface::burn_checked(
            CpiContext::new(
                accounts.company_token_program.key(),
                BurnChecked {
                    mint: accounts.company_mint.to_account_info(),
                    from: accounts.holder_token.to_account_info(),
                    authority: accounts.holder.to_account_info(),
                },
            ),
            amount,
            accounts.company_mint.decimals,
        )?;

        let company_mint_key = accounts.company_mint.key();
        let seeds: &[&[u8]] = &[COMPANY_SEED, company_mint_key.as_ref(), &[accounts.company.bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                accounts.usdc_token_program.key(),
                TransferChecked {
                    from: accounts.usdc_vault.to_account_info(),
                    mint: accounts.usdc_mint.to_account_info(),
                    to: accounts.recipient_usdc.to_account_info(),
                    authority: accounts.company.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            accounts.usdc_mint.decimals,
        )?;

        check_backing(&mut accounts.company_mint, &mut accounts.usdc_vault)
    }
}

/// The 1:1 invariant: every company token in existence is backed by one unit of USDC in the vault.
fn check_backing<'info>(
    company_mint: &mut InterfaceAccount<'info, Mint>,
    usdc_vault: &mut InterfaceAccount<'info, TokenAccount>,
) -> Result<()> {
    company_mint.reload()?;
    usdc_vault.reload()?;
    require_eq!(company_mint.supply, usdc_vault.amount, VaultError::BackingMismatch);
    Ok(())
}

#[account]
#[derive(InitSpace)]
pub struct Company {
    /// Registered the company; informational (the vault has no admin powers over funds).
    pub admin: Pubkey,
    pub company_mint: Pubkey,
    pub usdc_mint: Pubkey,
    pub usdc_vault: Pubkey,
    pub bump: u8,
    pub vault_bump: u8,
}

#[derive(Accounts)]
pub struct InitCompany<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Company::INIT_SPACE,
        seeds = [COMPANY_SEED, company_mint.key().as_ref()],
        bump,
    )]
    pub company: Account<'info, Company>,

    #[account(
        mint::token_program = company_token_program,
        constraint = company_mint.mint_authority == COption::Some(company.key()) @ VaultError::MintAuthorityNotVault,
        constraint = company_mint.supply == 0 @ VaultError::SupplyNotEmpty,
        constraint = company_mint.decimals == usdc_mint.decimals @ VaultError::DecimalsMismatch,
    )]
    pub company_mint: InterfaceAccount<'info, Mint>,

    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [VAULT_SEED, company.key().as_ref()],
        bump,
        token::mint = usdc_mint,
        token::authority = company,
        token::token_program = usdc_token_program,
    )]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,

    /// Company tokens must be Token-2022, the program with confidential transfers.
    #[account(address = TOKEN_2022_PROGRAM_ID @ VaultError::NotToken2022)]
    pub company_token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Wrap<'info> {
    pub depositor: Signer<'info>,

    #[account(
        seeds = [COMPANY_SEED, company_mint.key().as_ref()],
        bump = company.bump,
        has_one = company_mint,
        has_one = usdc_mint,
        has_one = usdc_vault,
    )]
    pub company: Account<'info, Company>,

    #[account(mut, mint::token_program = company_token_program)]
    pub company_mint: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = usdc_mint, token::authority = depositor, token::token_program = usdc_token_program)]
    pub depositor_usdc: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = company_mint, token::token_program = company_token_program)]
    pub recipient_token: InterfaceAccount<'info, TokenAccount>,

    pub company_token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct Unwrap<'info> {
    pub holder: Signer<'info>,

    #[account(
        seeds = [COMPANY_SEED, company_mint.key().as_ref()],
        bump = company.bump,
        has_one = company_mint,
        has_one = usdc_mint,
        has_one = usdc_vault,
    )]
    pub company: Account<'info, Company>,

    #[account(mut, mint::token_program = company_token_program)]
    pub company_mint: InterfaceAccount<'info, Mint>,
    #[account(mint::token_program = usdc_token_program)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut)]
    pub usdc_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(mut, token::mint = company_mint, token::authority = holder, token::token_program = company_token_program)]
    pub holder_token: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = usdc_mint, token::token_program = usdc_token_program)]
    pub recipient_usdc: InterfaceAccount<'info, TokenAccount>,

    pub company_token_program: Interface<'info, TokenInterface>,
    pub usdc_token_program: Interface<'info, TokenInterface>,
}

#[event]
pub struct CompanyRegistered {
    pub company: Pubkey,
    pub company_mint: Pubkey,
    pub usdc_mint: Pubkey,
}

#[error_code]
pub enum VaultError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("The company token's mint authority must be the company vault PDA")]
    MintAuthorityNotVault,
    #[msg("The company token must start with zero supply")]
    SupplyNotEmpty,
    #[msg("The company token must have the same decimals as USDC")]
    DecimalsMismatch,
    #[msg("Company tokens must use the Token-2022 program")]
    NotToken2022,
    #[msg("Company token supply must equal the USDC held in the vault")]
    BackingMismatch,
}
