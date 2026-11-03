export type Selector =
  | { kind: 'block'; index: number }
  | {
      kind: 'page'
      page: number
      start: number
      end: number
      bbox?: [number, number, number, number]
    }
  | { kind: 'char'; start: number; end: number }

export interface Fragment {
  ordinal: number
  selector: Selector
  text: string
}

export interface Extraction {
  fragments: Fragment[]
  /** Plain text the viewer shows when the source has no view of its own (email); `char` selectors index into it. */
  normalized_text?: string
  pages?: number
}
