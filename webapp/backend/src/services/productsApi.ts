/**
 * Product Master — a per-WhatsApp-number price catalog an agent picks from when building a Lead's
 * Quotation (see Phase22Api's quotation methods). Scoped by number the same way Leads' own
 * location isolation is: SUPERVISOR/SITE_MANAGER can only manage products for a number they
 * actually have access to (NumberAccess grant or team ownership); ADMIN and any agent with number
 * access can read the catalog (an agent needs to see prices to build a quote, not just managers).
 */
import { ApiError } from '../types';
import { Ids, Permissions, Roles, Validation } from '../domain/phase1';
import type { Product } from '../domain/types';
import { Repository } from '../lib/repository';
import { AccessControl, type Phase1Repositories } from '../lib/accessControl';
import { AuditLogService } from '../lib/auditLog';
import { AppDb } from '../lib/appDb';
import { buildPhase1Repositories } from '../lib/phase1Repositories';

export class ProductsApi {
  private access: AccessControl;
  private audit: AuditLogService;
  private products: Repository<Product>;

  constructor(db: AppDb, identityEmail: string) {
    const repos: Phase1Repositories = buildPhase1Repositories(db);
    this.audit = new AuditLogService(db);
    this.access = new AccessControl(repos, this.audit, identityEmail);
    this.products = new Repository<Product>(db, 'products');
  }

  private async canSeeNumber(actorId: string, numberId: string): Promise<boolean> {
    if (await this.access.hasGrantedNumber(actorId, numberId)) return true;
    return (await this.access.resolveTeamIdForNumber(numberId)) !== null;
  }

  /** Any authenticated user with access to the number can read its catalog — an agent building a
   * quote needs real prices, not just a manager defining them. */
  async listProducts(numberId: string): Promise<Product[]> {
    const actor = await this.access.currentUser();
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.canSeeNumber(actor.id, numberId))) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this WhatsApp number.');
    }
    const all = await this.products.list();
    return all.filter((p) => p.numberId === numberId).sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  }

  async createProduct(input: { numberId: string; name: string; sku?: string; unitPrice: number; description?: string }): Promise<Product> {
    const actor = await this.access.require(Permissions.PRODUCTS_MANAGE);
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.canSeeNumber(actor.id, input.numberId))) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this WhatsApp number.');
    }
    const name = Validation.requiredString(input.name, 'name');
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ApiError(400, 'VALIDATION_ERROR', 'unitPrice must be a non-negative number.');
    const now = Ids.now();
    const sameNumber = (await this.products.list()).filter((p) => p.numberId === input.numberId);
    const record: Product = {
      id: Ids.create('product'), numberId: input.numberId, name, sku: (input.sku || '').trim(), unitPrice,
      description: (input.description || '').trim(), active: true, sequenceOrder: sameNumber.length + 1, createdAt: now, updatedAt: now,
    };
    await this.products.create(record);
    await this.audit.write(actor.id, 'product.created', 'product', record.id, { numberId: input.numberId, name });
    return record;
  }

  async updateProduct(id: string, patch: Record<string, unknown>): Promise<Product> {
    const actor = await this.access.require(Permissions.PRODUCTS_MANAGE);
    const existing = await this.products.get(id);
    if (!existing) throw new ApiError(404, 'NOT_FOUND', 'Product was not found.');
    if (!(await this.access.hasRole(actor, Roles.ADMIN)) && !(await this.canSeeNumber(actor.id, existing.numberId))) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this WhatsApp number.');
    }
    const allowed = ['name', 'sku', 'unitPrice', 'description', 'active', 'sequenceOrder'];
    const safePatch: Record<string, unknown> = {};
    for (const key of Object.keys(patch || {})) {
      if (!allowed.includes(key)) throw new ApiError(400, 'VALIDATION_ERROR', `Field cannot be updated: ${key}`);
      safePatch[key] = patch[key];
    }
    if (safePatch.name !== undefined) safePatch.name = Validation.requiredString(safePatch.name, 'name');
    if (safePatch.unitPrice !== undefined) {
      const unitPrice = Number(safePatch.unitPrice);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new ApiError(400, 'VALIDATION_ERROR', 'unitPrice must be a non-negative number.');
      safePatch.unitPrice = unitPrice;
    }
    const record = await this.products.update(id, safePatch as Partial<Product>);
    await this.audit.write(actor.id, 'product.updated', 'product', id, { patch: safePatch });
    return record;
  }
}
