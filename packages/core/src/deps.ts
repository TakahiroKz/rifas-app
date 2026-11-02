import type {
  AuthRepository,
  Clock,
  CodeGenerator,
  DrawResultRepository,
  IdGenerator,
  LotterySource,
  OrganizationRepository,
  PrizeRepository,
  RaffleRepository,
  TicketRepository,
} from "./ports";

export interface Deps {
  auth: AuthRepository;
  prizes: PrizeRepository;
  results: DrawResultRepository;
  source: LotterySource;
  orgs: OrganizationRepository;
  raffles: RaffleRepository;
  tickets: TicketRepository;
  clock: Clock;
  ids: IdGenerator;
  codes: CodeGenerator;
}
