import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  type CodeBlockEditorDescriptor,
  type CodeBlockEditorProps,
  CreateLink,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  ListsToggle,
  MDXEditor,
  Separator,
  UndoRedo,
  codeBlockPlugin,
  frontmatterPlugin,
  headingsPlugin,
  imagePlugin,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  markdownShortcutPlugin,
  quotePlugin,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  useCodeBlockEditorContext,
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

function PlainCodeBlockEditor({ code, language, focusEmitter }: CodeBlockEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const { setCode } = useCodeBlockEditorContext()

  useEffect(() => {
    focusEmitter.subscribe(() => textareaRef.current?.focus())
  }, [focusEmitter])

  return (
    <div className="plain-code-block-editor">
      <div className="plain-code-block-editor-bar">{language || 'text'}</div>
      <textarea
        ref={textareaRef}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return
          event.preventDefault()
          const target = event.currentTarget
          const start = target.selectionStart
          const end = target.selectionEnd
          setCode(`${code.slice(0, start)}\t${code.slice(end)}`)
          requestAnimationFrame(() => {
            target.setSelectionRange(start + 1, start + 1)
          })
        }}
        spellCheck={false}
      />
    </div>
  )
}

const plainCodeBlockEditorDescriptor: CodeBlockEditorDescriptor = {
  priority: 1,
  match: () => true,
  Editor: PlainCodeBlockEditor,
}

const richEditorPlugins = [
  frontmatterPlugin(),
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  linkPlugin(),
  linkDialogPlugin(),
  imagePlugin(),
  tablePlugin(),
  codeBlockPlugin({
    defaultCodeBlockLanguage: 'text',
    codeBlockEditorDescriptors: [plainCodeBlockEditorDescriptor],
  }),
  markdownShortcutPlugin(),
  toolbarPlugin({
    toolbarContents: () => (
      <>
        <UndoRedo />
        <Separator />
        <BlockTypeSelect />
        <BoldItalicUnderlineToggles />
        <CodeToggle />
        <Separator />
        <ListsToggle options={['bullet', 'number', 'check']} />
        <CreateLink />
        <InsertImage />
        <InsertTable />
        <InsertCodeBlock />
      </>
    ),
  }),
]

export interface RichMarkdownEditorProps {
  editorKey: string
  scrollRef: RefObject<HTMLDivElement | null>
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onScroll: () => void
}

export default function RichMarkdownEditor({
  editorKey,
  scrollRef,
  value,
  onChange,
  onSave,
  onScroll,
}: RichMarkdownEditorProps) {
  return (
    <div
      ref={scrollRef}
      className="rich-editor-scroll"
      onScroll={onScroll}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          void onSave()
        }
      }}
    >
      <MDXEditor
        key={editorKey}
        className="rich-markdown-editor"
        contentEditableClassName="rich-markdown-content"
        markdown={value}
        onChange={(markdown, initialMarkdownNormalize) => {
          if (!initialMarkdownNormalize) {
            onChange(markdown)
          }
        }}
        plugins={richEditorPlugins}
        placeholder="开始写 Markdown..."
        trim={false}
      />
    </div>
  )
}
