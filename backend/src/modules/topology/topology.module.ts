import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TopologySnapshot } from '../../domain/entities';
import { TopologyController } from './topology.controller';
import { TopologyService } from './topology.service';

@Module({
  imports: [TypeOrmModule.forFeature([TopologySnapshot])],
  controllers: [TopologyController],
  providers: [TopologyService],
  exports: [TopologyService],
})
export class TopologyModule {}
