import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import { Role } from './role.entity';

@Entity('users')
export class User {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'admin@local' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  email: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  displayName: string | null;

  /** bcrypt hash - never serialised. */
  @Exclude()
  @Column({ type: 'varchar', length: 255 })
  passwordHash: string;

  @ApiProperty()
  @Column({ type: 'boolean', default: true })
  active: boolean;

  @ApiProperty({ type: () => [Role] })
  @ManyToMany(() => Role, (role) => role.users, { eager: true, cascade: ['insert'] })
  @JoinTable({ name: 'user_roles' })
  roles: Role[];

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastLoginAt: Date | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
