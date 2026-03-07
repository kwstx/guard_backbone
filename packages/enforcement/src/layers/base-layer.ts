import { ActionContext } from '../core/models';
import { EnforcementEventBus } from '../core/event-bus';

export abstract class BaseEnforcementLayer {
    protected eventBus: EnforcementEventBus;

    constructor() {
        this.eventBus = EnforcementEventBus.getInstance();
    }

    abstract getName(): string;
    abstract process(context: ActionContext): Promise<ActionContext>;
}
