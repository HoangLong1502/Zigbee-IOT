import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role, User } from '../../domain/entities';
import { AuthConfig } from '../../config/configuration';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, Role]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const auth = configService.getOrThrow<AuthConfig>('auth');
        return {
          secret: auth.jwtSecret,
          // Cast: @nestjs/jwt types `expiresIn` as ms.StringValue, but we accept
          // any duration string from the environment (e.g. "7d", "12h").
          signOptions: { expiresIn: auth.jwtExpiresIn as `${number}d` },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
