// ChamaPot's custom AG Studio widgets, registered alongside Studio's own. Each declares a
// `formatShape` and `ai` metadata, so Studio's built-in Widget and Page agents (and the Claude
// Treasurer, which delegates to them) can find, place and configure them by name.

import type { AgDefaultWidgetDefinition, AgWidgetsConfig } from 'ag-studio';
import type { AgRegistry } from 'ag-studio-react';
import { createWidgets } from 'ag-studio-react';
import { approvalTrackerWidget } from './approval-tracker';
import { potProgressWidget } from './pot-progress';
import { rotationWheelWidget } from './rotation-wheel';

export type ChamaWidgetDefinition = typeof potProgressWidget | typeof rotationWheelWidget | typeof approvalTrackerWidget;

/** Studio's registry with the ChamaPot widget types added, so report state can name them. */
export interface ChamaRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | ChamaWidgetDefinition)[];
}

export const CHAMA_WIDGET_IDS = ['pot-progress', 'rotation-wheel', 'approval-tracker'] as const;

/** The widget definitions themselves (contract name for other agents). */
export const chamaWidgetDefinitions = [potProgressWidget, rotationWheelWidget, approvalTrackerWidget] as const;

/**
 * The `widgets` property for <AgStudio>: Studio's own widgets plus the ChamaPot ones, listed first
 * in the Compose menu under "ChamaPot".
 */
export const chamaWidgets = (defaults: AgWidgetsConfig): AgWidgetsConfig<ChamaRegistry> =>
  createWidgets<ChamaRegistry>({
    additionalTypes: [...chamaWidgetDefinitions] as never,
    menu: [{ label: 'ChamaPot', widgetIds: [...CHAMA_WIDGET_IDS] }, ...(defaults.menu as never[])],
  });

export { approvalTrackerWidget, potProgressWidget, rotationWheelWidget };
