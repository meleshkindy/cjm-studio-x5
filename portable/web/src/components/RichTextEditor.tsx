import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Quote, Redo2, RemoveFormatting, Strikethrough, Underline as UnderlineIcon, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { RichDoc } from '../types'
import { imageSource } from '../offline'

const PortableImage = Image.extend({
  addNodeView() {
    return ({ node }) => {
      const img = document.createElement('img')
      img.src = imageSource(node.attrs.src) || ''
      img.alt = node.attrs.alt || ''
      img.title = node.attrs.title || ''
      return { dom: img }
    }
  },
})

interface RichTextEditorProps {
  value: RichDoc
  onCommit: (value: RichDoc) => void
  label: string
}

export function RichTextEditor({ value, onCommit, label }: RichTextEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, code: false, codeBlock: false, horizontalRule: false, link: false }),
      Link.configure({ openOnClick: false, autolink: true, defaultProtocol: 'https', protocols: ['http', 'https'] }),
      PortableImage.configure({ allowBase64: false, inline: false }),
    ],
    content: value,
    editorProps: { attributes: { class: 'rich-editor-content', 'aria-label': label } },
    onBlur: ({ editor: current }) => onCommit(current.getJSON()),
  })

  useEffect(() => {
    if (!editor) return
    const incoming = JSON.stringify(value)
    const current = JSON.stringify(editor.getJSON())
    if (incoming !== current) editor.commands.setContent(value)
  }, [editor, value])

  if (!editor) return <div className="rich-editor loading">Загрузка редактора…</div>

  const link = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const href = prompt('Web-ссылка (http:// или https://)', previous || 'https://')
    if (href === null) return
    if (!href) { editor.chain().focus().unsetLink().run(); return }
    try {
      const parsed = new URL(href)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error()
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    } catch {
      alert('Разрешены только корректные ссылки http:// и https://')
    }
  }

  const upload = async (file?: File) => {
    if (!file) return
    setUploading(true)
    try {
      const asset = await api.uploadAsset(file)
      editor.chain().focus().setImage({ src: asset.url, alt: asset.name, title: asset.name }).run()
      onCommit(editor.getJSON())
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const tool = (labelText: string, active: boolean, action: () => void, icon: React.ReactNode) => (
    <button type="button" className={active ? 'rich-tool active' : 'rich-tool'} aria-label={labelText} aria-pressed={active} onMouseDown={(event) => event.preventDefault()} onClick={action}>{icon}</button>
  )

  return (
    <div className="rich-editor">
      <div className="rich-toolbar" role="toolbar" aria-label={`Форматирование: ${label}`}>
        {tool('Полужирный', editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), <Bold size={16} />)}
        {tool('Курсив', editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), <Italic size={16} />)}
        {tool('Подчёркнутый', editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon size={16} />)}
        {tool('Зачёркнутый', editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), <Strikethrough size={16} />)}
        <span className="toolbar-separator" />
        {tool('Подзаголовок', editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), <Heading2 size={16} />)}
        {tool('Маркированный список', editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), <List size={16} />)}
        {tool('Нумерованный список', editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={16} />)}
        {tool('Цитата', editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={16} />)}
        <span className="toolbar-separator" />
        {tool('Web-ссылка', editor.isActive('link'), link, <Link2 size={16} />)}
        <input ref={fileRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => upload(event.target.files?.[0])} />
        <button type="button" className="rich-tool" aria-label="Вставить изображение" disabled={uploading} onClick={() => fileRef.current?.click()}><ImagePlus size={16} /></button>
        <span className="toolbar-separator" />
        <button type="button" className="rich-tool" aria-label="Очистить форматирование" onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}><RemoveFormatting size={16} /></button>
        <button type="button" className="rich-tool" aria-label="Отменить" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}><Undo2 size={16} /></button>
        <button type="button" className="rich-tool" aria-label="Повторить" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}><Redo2 size={16} /></button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
