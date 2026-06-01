import type { RefObject } from 'react'
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
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
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'

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
  codeBlockPlugin({ defaultCodeBlockLanguage: 'text' }),
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
