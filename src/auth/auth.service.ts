import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import type {
  LoginResponseDto,
  UserResponseDto,
} from './dto/auth-response.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { RegisterDto } from './dto/register.dto.js';
import type { JwtPayload } from './interfaces/auth-user.interface.js';

@Injectable()
export class AuthService {
  private readonly saltRounds: number;
  // Compared against when the email is unknown so that login takes the same
  // time whether or not the account exists (prevents user enumeration).
  private readonly dummyHash: string;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.saltRounds = Number(
      this.configService.get<string>('BCRYPT_SALT_ROUNDS', '10'),
    );
    this.dummyHash = bcrypt.hashSync('dummy-password', this.saltRounds);
  }

  async register(dto: RegisterDto): Promise<UserResponseDto> {
    if (await this.usersService.existsByEmail(dto.email)) {
      throw new ConflictException('Email is already registered');
    }

    const password = await bcrypt.hash(dto.password, this.saltRounds);
    // A concurrent registration with the same email that slips past the check
    // above is rejected by the unique index and mapped to 409 by QueryFailedFilter.
    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      password,
    });

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const user = await this.usersService.findByEmailWithPassword(dto.email);
    const passwordMatches = await bcrypt.compare(
      dto.password,
      user?.password ?? this.dummyHash,
    );

    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = { sub: user.id, email: user.email };
    return {
      accessToken: await this.jwtService.signAsync(payload),
      tokenType: 'Bearer',
      expiresIn: this.configService.get<string>('JWT_EXPIRES_IN', '1h'),
    };
  }
}
