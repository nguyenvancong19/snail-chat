import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { activateScheduledPlans } from '../billing/plan-changes.mjs';
import { syncGhnOrders } from '../orders/ghn-auto.mjs';
import { stopPageEvents } from '../shops/page-events.mjs';
import { db, run } from '../db/store.mjs';
import { privateCommentAiTick, queueEnabled, refreshInstagram, replyTick, syncFacebookComments } from './meta.mjs';

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private privateAiTimer?: ReturnType<typeof setInterval>;
  private privateAiWork?: Promise<unknown>;
  private timer?: ReturnType<typeof setInterval>;
  private messageTimer?: ReturnType<typeof setInterval>;
  private commentSyncTimer?: ReturnType<typeof setInterval>;
  private ghnTimer?: ReturnType<typeof setInterval>;
  private ghnWork?: Promise<unknown>;
  private cleanupTimer?: ReturnType<typeof setInterval>;
  private work?: Promise<unknown>;
  private messageWork?: Promise<unknown>;
  private commentSyncWork?: Promise<unknown>;
  private cleanupWork?: Promise<unknown>;

  private billingTimer?: ReturnType<typeof setInterval>;
  private billingWork?: Promise<unknown>;

  onModuleInit() {
    const billingTick=()=>{
      if(this.billingWork)return;
      this.billingWork=activateScheduledPlans().catch((error)=>{
        console.error('Subscription transition error:',error.code??error.name);
      }).finally(()=>{this.billingWork=undefined;});
    };
    billingTick();
    this.billingTimer=setInterval(billingTick,5000);
    if (!queueEnabled) return;
    this.messageTimer = setInterval(() => {
      if (this.messageWork) return;
      this.messageWork = replyTick(true).catch((error) => {
        console.error('Messenger queue error:', error.code ?? error.name);
      }).finally(() => { this.messageWork = undefined; });
    }, 1000);
    this.commentSyncTimer = setInterval(() => {
      if (this.commentSyncWork) return;
      this.commentSyncWork = syncFacebookComments().catch((error) => {
        console.error('Facebook comment sync error:', error.code ?? error.name);
      }).finally(() => { this.commentSyncWork = undefined; });
    }, 2_000);
    this.privateAiTimer = setInterval(() => {
      if (this.privateAiWork) return;
      this.privateAiWork = privateCommentAiTick().catch((error) => {
        console.error('Private comment AI queue error:', error.code ?? error.name);
      }).finally(() => { this.privateAiWork = undefined; });
    }, 2000);
    this.timer = setInterval(() => {
      if (this.work) return;
      this.work = replyTick().catch((error) => {
        console.error('Comment reply queue error:', error.code ?? error.name);
      }).finally(() => { this.work = undefined; });
    }, 2000);
    this.ghnTimer = setInterval(() => {
      if (this.ghnWork) return;
      this.ghnWork = syncGhnOrders().catch((error) => {
        console.error('GHN queue error:', error.code ?? error.name);
      }).finally(() => { this.ghnWork = undefined; });
    }, 2000);
    this.cleanupTimer = setInterval(() => {
      if (this.cleanupWork) return;
      this.cleanupWork = this.cleanup().catch((error) => {
        console.error('Cleanup error:', error.name);
      }).finally(() => { this.cleanupWork = undefined; });
    }, 60 * 60_000);
  }

  async onModuleDestroy() {
    clearInterval(this.billingTimer);
    clearInterval(this.timer);
    clearInterval(this.privateAiTimer);
    clearInterval(this.messageTimer);
    clearInterval(this.commentSyncTimer);
    clearInterval(this.cleanupTimer);
    clearInterval(this.ghnTimer);
    await Promise.allSettled([this.billingWork,this.privateAiWork,this.work, this.messageWork, this.commentSyncWork, this.cleanupWork, this.ghnWork]);
    await stopPageEvents();
    await db.end();
  }

  private async cleanup() {
    const now = Date.now();
    await run('DELETE FROM sessions WHERE expires<$1', now);
    await run('DELETE FROM oauth WHERE expires<$1', now);
    await run('DELETE FROM meta_choices WHERE expires<$1', now);
    await run('DELETE FROM password_resets WHERE expires<$1', now);
    await run('DELETE FROM email_verifications WHERE expires<$1', now);
    await run('DELETE FROM login_attempts WHERE expires<$1', now);
    await refreshInstagram();
  }
}
