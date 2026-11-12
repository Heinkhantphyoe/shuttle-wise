import { useEffect, useId, useRef, useState } from 'react'
import { routeIds, routeLabel } from './schedule'
import type { AffectedDirection } from './travel-contract'

const options = [
  ...routeIds.map(route => ({ value: route, label: routeLabel(route), hint: 'One direction' })),
  { value: 'both' as const, label: 'Both directions', hint: 'APU and Bukit Jalil LRT' },
]

export function DirectionSelect({ value, onChange, disabled }: {
  value: AffectedDirection | ''
  onChange: (value: AffectedDirection) => void
  disabled: boolean
}) {
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const selected = options.findIndex(option => option.value === value)

  useEffect(() => {
    if (!open) return
    root.current?.querySelector('[role="listbox"]')?.scrollIntoView({ block: 'nearest' })
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])

  useEffect(() => {
    if (open) root.current?.querySelectorAll('[role="option"]')[active]?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  function choose(index: number) {
    onChange(options[index].value)
    setOpen(false)
  }

  return <div className="direction-field" ref={root}>
    <label id={`${id}-label`} htmlFor={id}>Affected direction</label>
    <button id={id} type="button" role="combobox" className="direction-select" disabled={disabled}
      aria-expanded={open} aria-haspopup="listbox" aria-controls={`${id}-options`}
      aria-labelledby={`${id}-label ${id}-value`} aria-required="true"
      aria-activedescendant={open ? `${id}-option-${active}` : undefined}
      onClick={() => { setActive(Math.max(0, selected)); setOpen(!open) }}
      onBlur={() => setOpen(false)} onKeyDown={event => {
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          event.preventDefault()
          const start = open ? active : Math.max(0, selected)
          setActive(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
            : !open ? start : (start + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
          setOpen(true)
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          if (open) choose(active)
          else { setActive(Math.max(0, selected)); setOpen(true) }
        } else if (event.key === 'Escape') {
          event.preventDefault(); setOpen(false)
        } else if (event.key === 'Tab') {
          if (open) choose(active)
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const match = options.findIndex(option => option.label.toLowerCase().startsWith(event.key.toLowerCase()))
          if (match >= 0) { event.preventDefault(); setActive(match); setOpen(true) }
        }
      }}>
      <span id={`${id}-value`} className={value ? undefined : 'direction-placeholder'}>
        {selected >= 0 ? options[selected].label : 'Choose a direction'}
      </span>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden="true"><path d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} /></svg>
    </button>
    {open && <ul id={`${id}-options`} className="direction-options" role="listbox" aria-labelledby={`${id}-label`}>
      {options.map((option, index) => <li key={option.value} id={`${id}-option-${index}`} role="option"
        aria-selected={value === option.value} data-active={active === index || undefined}
        onPointerMove={() => setActive(index)} onPointerDown={event => event.preventDefault()}
        onClick={() => choose(index)}>
        <span><strong>{option.label}</strong><small>{option.hint}</small></span>
        {value === option.value && <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
      </li>)}
    </ul>}
  </div>
}
