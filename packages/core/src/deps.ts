import type {
  AuthRepository,
  Clock,
  CodeGenerator,
  IdGenerator,
  OrganizationRepository,
  RaffleRepository,
  TicketRepository,
} from "./ports";

export interface Deps {
  auth: AuthRepository;
  orgs: OrganizationRepository;
  raffles: RaffleRepository;
  tickets: TicketRepository;
  clock: Clock;
  ids: IdGenerator;
  codes: CodeGenerator;
}
