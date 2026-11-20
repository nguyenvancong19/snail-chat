import { LocalizationController } from './localization/localization.controller.js';
import { BillingController } from './billing/billing.controller.js';
import { OrdersController } from './orders/orders.controller.js';
import { OpenRouterController } from './ai/openrouter.controller.js';
import { CatalogController } from './catalog/catalog.controller.js';
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AccountsController, ThemeController } from './accounts/accounts.controller.js';
import { AuthController } from './auth/auth.controller.js';
import { EngagementController } from './engagement/engagement.controller.js';
import { ErrorsFilter } from './http/errors.filter.js';
import { SessionGuard } from './http/session.guard.js';
import { MetaController } from './meta/meta.controller.js';
import { QueueService } from './meta/queue.service.js';
import { ShopsController } from './shops/shops.controller.js';
import { WorkspaceController } from './workspace/workspace.controller.js';

@Module({
  controllers: [LocalizationController, ThemeController, OrdersController, CatalogController, OpenRouterController, AccountsController, AuthController, EngagementController, MetaController, WorkspaceController, ShopsController, BillingController],
  providers: [QueueService,
    { provide: APP_FILTER, useClass: ErrorsFilter },
    { provide: APP_GUARD, useClass: SessionGuard },
  ],
})
export class AppModule {}
