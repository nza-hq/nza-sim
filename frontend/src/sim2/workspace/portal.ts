/** react-dom's createPortal, typed here: this checkout has no @types/react-dom (package.json only gets new packages
 * when a person installs them). */
import type { ReactNode, ReactPortal } from 'react'
// @ts-expect-error untyped here; createPortal(children, container, key?) is react-dom 18's own signature
import { createPortal as cp } from 'react-dom'

export const createPortal = cp as (children: ReactNode, container: Element, key?: string | null) => ReactPortal
