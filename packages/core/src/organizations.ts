import type { Deps } from "./deps";
import { fail, ok, type Result } from "./result";
import type { Organization } from "./types";
import { cleanText, isValidPhone, isValidSlug } from "./validation";

export interface CreateOrganizationInput {
  name: string;
  slug: string;
  whatsappPhone: string;
}

export async function createOrganization(
  deps: Deps,
  input: CreateOrganizationInput,
): Promise<Result<Organization>> {
  const name = cleanText(input.name, 80);
  if (!name || name.length < 2) return fail("invalid_input", "El nombre es obligatorio");
  if (!isValidSlug(input.slug))
    return fail("invalid_input", "El identificador (slug) no es válido");
  if (!isValidPhone(input.whatsappPhone)) {
    return fail("invalid_input", "El teléfono debe tener 10 a 15 dígitos, sin '+'");
  }

  const org: Organization = {
    id: deps.ids.uuid(),
    name,
    slug: input.slug,
    whatsappPhone: input.whatsappPhone,
    createdAt: deps.clock.now().toISOString(),
  };
  const created = await deps.orgs.create(org);
  if (!created.ok) return fail("slug_taken", "Ya existe una organización con ese identificador");
  return ok(org);
}
