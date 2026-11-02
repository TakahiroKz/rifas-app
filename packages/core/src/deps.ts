import type {
  Clock,
  CodeGenerator,
  IdGenerator,
  OrganizationRepository,
  RaffleRepository,
  TicketRepository,
} from "./ports";

export interface Deps {
  orgs: OrganizationRepository;
  raffles: RaffleRepository;
  tickets: TicketRepository;
  clock: Clock;
  ids: IdGenerator;
  codes: CodeGenerator;
}
