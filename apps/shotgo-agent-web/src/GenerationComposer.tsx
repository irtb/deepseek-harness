import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GenerationContext } from './agent-session.ts'
import type { GenerationConfig, GenerationOption } from './generation.ts'
import { resolveMediaUrl, type MediaLibraryItem } from './media-library.ts'

const MODEL_VALUE_MAX_PX = 300

function optionLabel(options: GenerationOption[], id: string | undefined): string {
  return options.find(item => item.id === id)?.label ?? id ?? '—'
}

function measureTextWidth(text: string, font: string): number {
  if (typeof document === 'undefined') return text.length * 8
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (context === null) return text.length * 8
  context.font = font
  return context.measureText(text).width
}

function ChipSelect({
  label,
  value,
  options,
  onChange,
  fitLongestLabel = false,
}: {
  label: string
  value: string | undefined
  options: GenerationOption[]
  onChange: (value: string) => void
  /** Size value to the longest option label, capped at 300px with ellipsis. */
  fitLongestLabel?: boolean
}) {
  const enabled = options.filter(item => item.enabled !== false)
  const text = optionLabel(enabled, value)
  const valueRef = useRef<HTMLSpanElement>(null)
  const [valueWidthPx, setValueWidthPx] = useState<number>()
  const labelsKey = useMemo(() => enabled.map(item => item.label).join('\0'), [enabled])

  useLayoutEffect(() => {
    if (!fitLongestLabel) {
      setValueWidthPx(undefined)
      return
    }
    const node = valueRef.current
    if (node === null) return
    const style = getComputedStyle(node)
    const font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const widest = enabled.reduce((max, item) => Math.max(max, measureTextWidth(item.label, font)), 0)
    setValueWidthPx(Math.min(Math.ceil(widest), MODEL_VALUE_MAX_PX))
  }, [enabled, fitLongestLabel, labelsKey])

  return (
    <label
      className={`composer-chip${fitLongestLabel ? ' composer-chip--model' : ''}`}
      title={`${label}：${text}`}
    >
      <span className="composer-chip__label">{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
        }}
      >
        {enabled.map(item => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
      <span
        ref={valueRef}
        className="composer-chip__value"
        style={valueWidthPx === undefined ? undefined : { width: `${valueWidthPx}px` }}
      >
        {text}
      </span>
    </label>
  )
}

/** Top rail: add / preview reference assets (liblib / KickArt style). */
export function ComposerAttachBar({
  referenceItems,
  onOpenReferences,
  onRemoveReference,
}: {
  referenceItems: MediaLibraryItem[]
  onOpenReferences: () => void
  onRemoveReference: (id: number) => void
}) {
  return (
    <div className="composer-attach" aria-label="参考素材">
      <button
        type="button"
        className="composer-attach__add"
        disabled={referenceItems.length >= 9}
        onClick={onOpenReferences}
      >
        <span className="composer-attach__plus" aria-hidden="true">＋</span>
        <span>参考素材</span>
        <em>{referenceItems.length}/9</em>
      </button>
      {referenceItems.length === 0 ? (
        <p className="composer-attach__hint">可上传或从素材库选择图片、视频，作为风格、主体或首帧参考</p>
      ) : (
        <div className="reference-strip" aria-label="已选参考素材">
          {referenceItems.map((item) => {
            const preview = resolveMediaUrl(item.thumbPath ?? item.path)
            return (
              <span key={item.id} className="reference-chip">
                {preview === undefined ? <i className="reference-chip__placeholder" /> : item.mediaType === 'video'
                  ? <video src={preview} muted playsInline preload="metadata" />
                  : <img src={preview} alt="" />}
                <b title={item.originalName ?? `素材 ${item.id}`}>{item.originalName ?? `素材 ${item.id}`}</b>
                <button
                  type="button"
                  aria-label={`移除 ${item.originalName ?? item.id}`}
                  onClick={() => {
                    onRemoveReference(item.id)
                  }}
                >
                  ×
                </button>
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Bottom param plugins under the prompt. */
export function ComposerParamBar({
  context,
  config,
  onChange,
}: {
  context: GenerationContext
  config: GenerationConfig
  onChange: (context: GenerationContext) => void
}) {
  const section = config[context.kind]
  const patch = (parameters: Partial<GenerationContext['parameters']>) => {
    onChange({ ...context, parameters: { ...context.parameters, ...parameters } })
  }
  return (
    <div className="generation-settings" aria-label="生成参数">
      <div className="composer-plugins" role="toolbar" aria-label="生成参数插件">
        <ChipSelect
          label="模型"
          fitLongestLabel
          value={context.modelId}
          options={section.models}
          onChange={(modelId) => {
            onChange({ ...context, modelId })
          }}
        />
        <ChipSelect
          label="比例"
          value={context.parameters.aspectRatioId}
          options={section.aspectRatios}
          onChange={(aspectRatioId) => {
            patch({ aspectRatioId })
          }}
        />
        <ChipSelect
          label="清晰度"
          value={context.parameters.resolutionId}
          options={section.resolutions}
          onChange={(resolutionId) => {
            patch({ resolutionId })
          }}
        />
        {context.kind === 'image' ? (
          <ChipSelect
            label="画质"
            value={context.parameters.qualityId}
            options={config.image.qualities}
            onChange={(qualityId) => {
              patch({ qualityId })
            }}
          />
        ) : (
          <>
            <label className="composer-chip composer-chip--duration" title="时长">
              <span className="composer-chip__label">时长</span>
              <input
                aria-label="时长"
                type="number"
                min={config.video.duration.min}
                max={config.video.duration.max}
                step={config.video.duration.step}
                value={context.parameters.duration}
                onChange={(event) => {
                  patch({ duration: Number(event.target.value) })
                }}
              />
              <span className="composer-chip__value">
                {context.parameters.duration ?? config.video.duration.min}s
              </span>
            </label>
            <label
              className={`composer-chip composer-chip--toggle${context.parameters.audio ? ' is-on' : ''}`}
              title="生成音频"
            >
              <input
                type="checkbox"
                checked={context.parameters.audio ?? false}
                onChange={(event) => {
                  patch({ audio: event.target.checked })
                }}
              />
              <span className="composer-chip__label">音频</span>
              <span className="composer-chip__value">{context.parameters.audio ? '开' : '关'}</span>
            </label>
          </>
        )}
      </div>
    </div>
  )
}

/** @deprecated Prefer ComposerAttachBar + ComposerParamBar */
export function GenerationComposer(props: {
  context: GenerationContext
  config: GenerationConfig
  referenceItems: MediaLibraryItem[]
  onOpenReferences: () => void
  onRemoveReference: (id: number) => void
  onChange: (context: GenerationContext) => void
}) {
  return (
    <>
      <ComposerAttachBar
        referenceItems={props.referenceItems}
        onOpenReferences={props.onOpenReferences}
        onRemoveReference={props.onRemoveReference}
      />
      <ComposerParamBar context={props.context} config={props.config} onChange={props.onChange} />
    </>
  )
}
