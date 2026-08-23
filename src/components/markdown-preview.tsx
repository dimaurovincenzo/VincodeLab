import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Checkbox } from '@/components/ui'
import { githubMarkdownStyles as md } from '@/theme/styles/github'
import { cx } from '../../styled-system/css'

type MarkdownPreviewProps = {
  source: string
}

export function MarkdownPreview({ source }: MarkdownPreviewProps) {
  return <article className={md.root}>
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      components={{
        a: ({ children, href, title }) => <a className={md.link} href={href} rel="noreferrer" target="_blank" title={title}>{children}</a>,
        blockquote: ({ children }) => <blockquote className={md.blockquote}>{children}</blockquote>,
        code: ({ children, className }) => <code className={cx(md.inlineCode, className)}>{children}</code>,
        h1: ({ children }) => <h1 className={cx(md.heading, md.h1)}>{children}</h1>,
        h2: ({ children }) => <h2 className={cx(md.heading, md.h2)}>{children}</h2>,
        h3: ({ children }) => <h3 className={cx(md.heading, md.h3)}>{children}</h3>,
        h4: ({ children }) => <h4 className={cx(md.heading, md.h3)}>{children}</h4>,
        input: ({ checked }) => <span className={md.checkbox}><Checkbox aria-label={checked ? 'Attività completata' : 'Attività non completata'} checked={Boolean(checked)} disabled label="" onCheckedChange={() => undefined} /></span>,
        li: ({ children }) => <li className={md.listItem}>{children}</li>,
        ol: ({ children }) => <ol className={md.list}>{children}</ol>,
        p: ({ children }) => <p className={md.paragraph}>{children}</p>,
        pre: ({ children }) => <pre className={md.pre}>{children}</pre>,
        table: ({ children }) => <table className={md.table}>{children}</table>,
        td: ({ children }) => <td className={md.tableCell}>{children}</td>,
        th: ({ children }) => <th className={cx(md.tableCell, md.tableHeader)}>{children}</th>,
        ul: ({ children }) => <ul className={md.list}>{children}</ul>,
      }}
    >
      {source}
    </ReactMarkdown>
  </article>
}
