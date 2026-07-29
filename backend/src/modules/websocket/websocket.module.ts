import { Global, Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * Global so that any module can push real-time updates without wiring the
 * gateway through every constructor chain.
 */
@Global()
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class WebsocketModule {}
