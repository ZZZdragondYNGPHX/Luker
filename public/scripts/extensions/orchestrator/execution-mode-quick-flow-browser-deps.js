import { getDisplayedScope } from './editor-display.js';
import { getCurrentAvatar } from './snapshot-cache.js';
import {
    getCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar,
} from './character-overrides.js';
import { persistOrchestratorCharacterExtension } from './editor-persist.js';
import {
    createPreset,
    deletePreset,
    getActivePresetId,
    setActivePresetId,
    writeActivePreset,
} from './preset-library.js';
import { configureQuickFlowRuntimeDeps } from './execution-mode-quick-flow.js';

// Keep browser/editor/preset-library dependencies outside the pure quick-Flow
// transaction module. Production still reuses the orchestrator's canonical
// preset/scope/avatar/card-persistence helpers, while Jest/Node can exercise
// commit/rollback semantics without inheriting the full browser import graph.
configureQuickFlowRuntimeDeps({
    createPreset,
    deletePreset,
    getActivePresetId,
    setActivePresetId,
    writeActivePreset,
    getDisplayedScope,
    getCurrentAvatar,
    getCharacterExtensionDataByAvatar,
    getCharacterIndexByAvatar,
    persistOrchestratorCharacterExtension,
});
