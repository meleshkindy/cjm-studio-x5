import { Fragment, type ReactNode } from 'react'
import type { RichDoc } from '../types'

interface NodeShape {
  type?: string
  text?: string
  attrs?: { href?: string; src?: string; alt?: string; title?: string; level?: number }
  marks?: Array<{ type?: string; attrs?: { href?: string } }>
  content?: NodeShape[]
}

function renderNode(node: NodeShape, key: number): ReactNode {
  const children = node.content?.map((child, index) => renderNode(child, index)) ?? null
  if (node.type === 'text') {
    let value: ReactNode = node.text ?? ''
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold') value = <strong>{value}</strong>
      if (mark.type === 'italic') value = <em>{value}</em>
      if (mark.type === 'underline') value = <u>{value}</u>
      if (mark.type === 'strike') value = <s>{value}</s>
      if (mark.type === 'link' && mark.attrs?.href) value = <a href={mark.attrs.href} target="_blank" rel="noopener noreferrer">{value}</a>
    }
    return <Fragment key={key}>{value}</Fragment>
  }
  switch (node.type) {
    case 'doc': return <Fragment key={key}>{children}</Fragment>
    case 'paragraph': return <p key={key}>{children || <br />}</p>
    case 'heading': return node.attrs?.level === 3 ? <h3 key={key}>{children}</h3> : <h2 key={key}>{children}</h2>
    case 'bulletList': return <ul key={key}>{children}</ul>
    case 'orderedList': return <ol key={key}>{children}</ol>
    case 'listItem': return <li key={key}>{children}</li>
    case 'blockquote': return <blockquote key={key}>{children}</blockquote>
    case 'hardBreak': return <br key={key} />
    case 'image': return <img key={key} src={node.attrs?.src} alt={node.attrs?.alt || ''} />
    default: return <Fragment key={key}>{children}</Fragment>
  }
}

export function RichTextView({ value }: { value: RichDoc }) {
  return <div className="rich-view">{renderNode(value as NodeShape, 0)}</div>
}
