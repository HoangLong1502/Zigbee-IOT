import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Role, RoleName, User } from '../../domain/entities';
import { AuthConfig } from '../../config/configuration';
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/auth.dto';
import type { JwtPayload } from './strategies/jwt.strategy';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);
  private readonly config: AuthConfig;

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Role) private readonly roles: Repository<Role>,
    private readonly jwt: JwtService,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<AuthConfig>('auth');
  }

  /** Seeds the three built-in roles and the initial admin account. */
  async onModuleInit(): Promise<void> {
    try {
      await this.seedRoles();
      await this.seedAdmin();
    } catch (error) {
      this.logger.error(`Auth seeding failed: ${(error as Error).message}`);
    }
  }

  private async seedRoles(): Promise<void> {
    const definitions: Array<{ name: RoleName; description: string }> = [
      { name: RoleName.ADMIN, description: 'Full access including settings and OTA' },
      { name: RoleName.OPERATOR, description: 'May control devices but not change settings' },
      { name: RoleName.VIEWER, description: 'Read-only access' },
    ];

    for (const definition of definitions) {
      const existing = await this.roles.findOne({ where: { name: definition.name } });
      if (!existing) await this.roles.save(this.roles.create(definition));
    }
  }

  private async seedAdmin(): Promise<void> {
    const existing = await this.users.count();
    if (existing > 0) return;

    const adminRole = await this.roles.findOneOrFail({ where: { name: RoleName.ADMIN } });
    const user = this.users.create({
      email: this.config.adminEmail,
      displayName: 'Administrator',
      passwordHash: await bcrypt.hash(this.config.adminPassword, 10),
      roles: [adminRole],
    });
    await this.users.save(user);

    this.logger.warn(
      `Created initial admin account "${this.config.adminEmail}" - change the password immediately`,
    );
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users.findOne({ where: { email: dto.email.toLowerCase() } });
    // Same error for unknown user and wrong password: no account enumeration.
    if (!user || !user.active) throw new UnauthorizedException('Invalid credentials');

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    user.lastLoginAt = new Date();
    await this.users.save(user);

    return this.buildResponse(user);
  }

  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    const email = dto.email.toLowerCase();
    const existing = await this.users.findOne({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const roleName = dto.role ?? RoleName.VIEWER;
    const role = await this.roles.findOneOrFail({ where: { name: roleName } });

    const user = this.users.create({
      email,
      displayName: dto.displayName ?? null,
      passwordHash: await bcrypt.hash(dto.password, 10),
      roles: [role],
    });
    await this.users.save(user);

    return this.buildResponse(user);
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  private buildResponse(user: User): AuthResponseDto {
    const roles = (user.roles ?? []).map((role) => String(role.name));
    const payload: JwtPayload = { sub: user.id, email: user.email, roles };

    return {
      accessToken: this.jwt.sign(payload),
      expiresIn: this.config.jwtExpiresIn,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        roles,
      },
    };
  }
}
