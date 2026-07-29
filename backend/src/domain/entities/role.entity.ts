import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { User } from './user.entity';

export enum RoleName {
  /** Full control incl. device management, OTA and settings. */
  ADMIN = 'admin',
  /** May send device commands but not change coordinator settings. */
  OPERATOR = 'operator',
  /** Read-only dashboard access. */
  VIEWER = 'viewer',
}

@Entity('roles')
export class Role {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: RoleName })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  name: RoleName | string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @ManyToMany(() => User, (user) => user.roles)
  users: User[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
