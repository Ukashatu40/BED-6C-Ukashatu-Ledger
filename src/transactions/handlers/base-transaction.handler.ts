// src/transactions/handlers/base-transaction.handler.ts
import { UnprocessableEntityException } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import type { LedgerService, PostedJournal } from '@ledger/ledger.service';
import type { AccountsRepository } from '@accounts/accounts.repository';
import type { TransactionType, Account } from '@prisma/client';
import type { CreateJournalEntryDto } from '@ledger/dto/create-journal-entry.dto';

/**
 * Context passed into every transaction handler.
 * Contains all injected services so handlers don't need their own constructors.
 */
export interface TransactionContext {
  ledger: LedgerService;
  accounts: AccountsRepository;
  actor: string;
  idempotencyKey?: string; // was: idempotencyKey: string — must be optional
}

/**
 * The result of processing any transaction type.
 */
export interface TransactionResult {
  transactionId: string;
  type: TransactionType;
  journal: PostedJournal;
  metadata?: Record<string, unknown>;
}

/**
 * Abstract base class for all 20 transaction type handlers.
 *
 * Each handler is responsible for:
 *   1. Validating its own business rules (limits, KYC, eligibility)
 *   2. Building the correct journal entry DTO for its transaction type
 *   3. Specifying which accounts need balance checks before debiting
 *
 * The base class handles:
 *   - Calling the ledger service to post the journal
 *   - Generating the transaction ID
 *   - Consistent error wrapping
 *
 * This separation means the LedgerService stays generic and the
 * accounting rules stay in their respective handlers — single responsibility.
 */
export abstract class BaseTransactionHandler {
  /**
   * Build the journal entry DTO for this transaction type.
   * Each handler implements the specific debit/credit pattern from spec A4.2.
   */
  protected abstract buildJournalEntry(
    transactionId: string,
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): CreateJournalEntryDto;

  /**
   * Return the account IDs that need a balance check before this transaction
   * can proceed. Empty array = no balance check (for funding transactions).
   */
  protected abstract getBalanceCheckAccounts(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): string[];

  /**
   * Validate business rules specific to this transaction type.
   * Throw UnprocessableEntityException if validation fails.
   */
  protected abstract validateBusinessRules(
    payload: Record<string, unknown>,
    accounts: Record<string, Account>,
  ): Promise<void>;

  /**
   * Execute the transaction.
   * Called by TransactionsService after idempotency is checked.
   */
  async execute(
    payload: Record<string, unknown>,
    accountMap: Record<string, Account>,
    ctx: TransactionContext,
  ): Promise<TransactionResult> {
    const transactionId = uuidv7();

    await this.validateBusinessRules(payload, accountMap);

    const dto = this.buildJournalEntry(transactionId, payload, accountMap);
    const balanceCheckAccounts = this.getBalanceCheckAccounts(payload, accountMap);

    const journal = await ctx.ledger.postJournalEntry(dto, ctx.actor, ctx.idempotencyKey, {
      checkBalanceOn: balanceCheckAccounts,
    });

    return { transactionId, type: dto.referenceType, journal };
  }

  protected requireAccount(accountMap: Record<string, Account>, key: string): Account {
    const account = accountMap[key];
    if (!account) {
      throw new UnprocessableEntityException(`Required account "${key}" not found`);
    }
    return account;
  }
}
