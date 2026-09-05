/**
 * Repository interfaces - Domain layer contracts for data access
 * These interfaces define what operations are available without specifying implementation
 */

import type { ObjectData, RawData } from '../../core/types';

/**
 * Base repository interface with common CRUD operations
 */
export interface IRepository<T extends ObjectData, R extends RawData> {
  /**
   * Find an entity by its ID
   */
  findById(id: string): Promise<T | null>;
  
  /**
   * Find all entities
   */
  findAll(): Promise<T[]>;
  
  /**
   * Save an entity (create or update)
   */
  save(entity: T): Promise<void>;
  
  /**
   * Delete an entity by ID
   */
  delete(id: string): Promise<void>;
  
  /**
   * Check if an entity exists
   */
  exists(id: string): Promise<boolean>;
}

/**
 * Repository for entities that support manifest-based listing
 */
export interface IManifestRepository<T extends ObjectData, R extends RawData> 
  extends IRepository<T, R> {
  /**
   * Get all entity IDs from manifest
   */
  getManifestIds(): Promise<string[]>;
  
  /**
   * Load a lightweight shell without full hydration
   */
  findShell(id: string): Promise<T | null>;
  
  /**
   * Load all shells without full hydration
   */
  findAllShells(): Promise<T[]>;
}

// Re-export specific repository types
export interface IStopPatternRepository extends IManifestRepository<
  import('../../core/types').StopPattern,
  import('../../core/types').RawStopPattern
> {}

export interface ISamplerRepository extends IManifestRepository<
  import('../../core/types').Sampler,
  import('../../core/types').RawSampler
> {}

export interface IContextRepository extends IManifestRepository<
  import('../../core/types').Context,
  import('../../core/types').RawContext
> {}

export interface ILanguageModelRepository extends IManifestRepository<
  import('../../core/types').LanguageModel,
  import('../../core/types').RawLanguageModel
> {}

export interface ICharacterRepository extends IManifestRepository<
  import('../../core/types').Character,
  import('../../core/types').RawCharacter
> {}

export interface IChatDataRepository extends IRepository<
  import('../../core/types').ChatData,
  import('../../core/types').RawChatData
> {}

export interface IMemoryRepository extends IManifestRepository<
  import('../../core/types').Memory,
  import('../../core/types').RawMemory
> {}

export interface IBudgetStrategyRepository extends IManifestRepository<
  import('../../core/types').BudgetStrategy,
  import('../../core/types').RawBudgetStrategy
> {}

export interface IProfileRepository extends IManifestRepository<
  import('../../core/types').Profile,
  import('../../core/types').RawProfile
> {}

export interface IWebpageRepository extends IManifestRepository<
  import('../../core/types').Webpage,
  import('../../core/types').RawWebpage
> {}

export interface IExtensionRepository extends IRepository<
  import('../../core/types').Extension,
  import('../../core/types').Extension
> {}

export interface IInterjectableActionRepository {
  getAll(): Promise<import('../../core/types').InterjectableAction[]>;
  save(actions: import('../../core/types').InterjectableAction[]): Promise<void>;
}
