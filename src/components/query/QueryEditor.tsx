import { useRef, useEffect } from "react";
import Editor, { OnMount, OnChange } from "@monaco-editor/react";
import {
  registerSqlCompletion,
  primeSchema,
  invalidateSchemaCache,
} from "../../lib/sqlCompletion";
import { useTheme } from "../../hooks/useTheme";
import { useSettings } from "../../hooks/useSettings";

interface QueryEditorProps {
  value: string;
  onChange: (value: string) => void;
  onExecute: () => void;
  onFormat?: () => void;
  readOnly?: boolean;
  /** Active session — drives schema-aware autocomplete. */
  sessionId?: string | null;
  /** Active database — drives schema-aware autocomplete. */
  database?: string | null;
  /**
   * Surface the Monaco editor instance once mounted so the host can read the
   * live selection / cursor position (for scoped Run / Run Selected).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEditorMount?: (editor: any) => void;
}

function QueryEditor({
  value,
  onChange,
  onExecute,
  onFormat,
  readOnly = false,
  sessionId = null,
  database = null,
  onEditorMount,
}: QueryEditorProps) {
  const { resolvedTheme } = useTheme();
  const { settings } = useSettings();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const editorRef = useRef<any>(null);
  const onExecuteRef = useRef(onExecute);
  const onFormatRef = useRef(onFormat);
  // Live schema context read by the completion provider on each invocation, so
  // changing connection/database does not require re-registering the provider.
  const schemaCtxRef = useRef<{ sessionId: string | null; database: string | null }>({
    sessionId,
    database,
  });
  const completionDisposableRef = useRef<{ dispose: () => void } | null>(null);

  // Keep the refs updated with latest functions
  useEffect(() => {
    onExecuteRef.current = onExecute;
    onFormatRef.current = onFormat;
  }, [onExecute, onFormat]);

  // Keep the schema context current and prime/refresh the cache when it changes.
  useEffect(() => {
    schemaCtxRef.current = { sessionId, database };
    if (sessionId && database) {
      invalidateSchemaCache(sessionId, database);
      primeSchema(sessionId, database);
    }
  }, [sessionId, database]);

  // Dispose the completion provider on unmount to avoid duplicate providers
  // accumulating across editor remounts.
  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose();
      completionDisposableRef.current = null;
    };
  }, []);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;

    // Register schema-aware SQL autocomplete once per mount.
    completionDisposableRef.current?.dispose();
    completionDisposableRef.current = registerSqlCompletion(
      monaco,
      () => schemaCtxRef.current
    );

    // Add keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      onExecuteRef.current();
    });

    // Add format shortcut (Shift+Alt+F)
    editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
      if (onFormatRef.current) {
        onFormatRef.current();
      }
    });

    // Focus the editor
    editor.focus();

    // Hand the live editor instance to the host (for selection / cursor reads).
    onEditorMount?.(editor);
  };

  const handleChange: OnChange = (value) => {
    onChange(value || "");
  };

  return (
    <div className="h-full w-full">
      <Editor
        height="100%"
        defaultLanguage="sql"
        value={value}
        onChange={handleChange}
        onMount={handleEditorDidMount}
        theme={resolvedTheme === "dark" ? "vs-dark" : "vs"}
        options={{
          minimap: { enabled: settings.editorMinimap },
          fontSize: settings.editorFontSize,
          fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          lineNumbers: "on",
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: settings.editorWordWrap ? "on" : "off",
          readOnly,
          renderWhitespace: "selection",
          bracketPairColorization: { enabled: true },
          suggest: {
            showKeywords: true,
            showSnippets: true,
          },
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false,
          },
        }}
      />
    </div>
  );
}

export default QueryEditor;
