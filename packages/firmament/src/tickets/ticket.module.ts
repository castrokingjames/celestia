// ticket.module.ts — provides the shared TicketService (depends on the @Global ConfigService).
// Polaris imports it to sign; Atlas imports it to verify.
import { Module } from "@nestjs/common";
import { TicketService } from "./ticket.service.js";

@Module({ providers: [TicketService], exports: [TicketService] })
export class TicketModule {}
