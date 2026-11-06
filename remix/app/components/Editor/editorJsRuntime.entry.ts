// Trusted fixed library entry evaluated in the owning editor document.
import { importEditorJsRuntime, EDITOR_RUNTIME_SLOT } from './editorJsRuntimeImports';
(window as any)[EDITOR_RUNTIME_SLOT] = importEditorJsRuntime;
