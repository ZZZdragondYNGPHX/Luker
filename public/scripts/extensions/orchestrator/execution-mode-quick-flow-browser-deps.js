import { getDisplayedScope } from './editor-display.js';
import { getCurrentAvatar } from './snapshot-cache.js';
import {
    getCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar,
} from './character-overrides.js';
import { persistOrchestratorCharacterExtension } from './editor-persist.js';
import { configureQuickFlowRuntimeDeps } from './execution-mode-quick-flow.js';

// Keep browser-only editor/snapshot/card-persistence imports outside the pure
// quick-Flow transaction module. Production still reuses the orchestrator's
// existing sources of truth; Jest/Node can exercise the transaction core
// without pulling unrelated DOM-only modules into the import graph.
configureQuickFlowRuntimeDeps({
    getDisplayedScope,
    getCurrentAvatar,
    getCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar,
    persistOrchestratorCharacterExtension,
});
