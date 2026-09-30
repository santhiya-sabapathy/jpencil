import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/** Rejects requests without a valid `Authorization: Bearer <token>` header (401). */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}
