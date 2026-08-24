import { CircleAlert, CircleCheck, Cpu } from 'lucide-react'
import type { RuntimeCapabilitiesSnapshot, RuntimeCapability } from '@/bridge'
import { Tabs } from '@/components/ui'
import { settingsStyles } from '@/theme/styles/settings'
import type { SettingsSectionFailure } from '../model/settings.types'
import { SettingsSectionError } from './settings-section-error'

function CapabilityItem({ capability }: { capability: RuntimeCapability }) {
  const StateIcon = capability.state === 'ready' ? CircleCheck : CircleAlert
  const stateLabel = capability.state === 'ready' ? 'Disponibile' : capability.state === 'missing' ? 'Non installato' : 'Da riparare'
  const stateClass = capability.state === 'ready'
    ? settingsStyles.capabilityStateReady
    : capability.state === 'missing' ? settingsStyles.capabilityStateMissing : settingsStyles.capabilityStateBroken
  const badgeClass = capability.state === 'ready'
    ? settingsStyles.capabilityBadgeReady
    : capability.state === 'missing' ? settingsStyles.capabilityBadgeMissing : settingsStyles.capabilityBadgeBroken
  return <li className={settingsStyles.capabilityItem}>
    <StateIcon aria-hidden="true" className={stateClass} size={17} />
    <span className={settingsStyles.capabilityCopy}>
      <span className={settingsStyles.capabilityTitle}>{capability.label}</span>
      <span className={settingsStyles.capabilityDetail}>{capability.detail}</span>
    </span>
    <span className={`${settingsStyles.capabilityState} ${badgeClass}`}>{stateLabel}</span>
  </li>
}

export function CompatibilitySettingsSection({
  failure,
  onRetry,
  refreshing,
  runtimeCapabilities,
}: {
  failure?: SettingsSectionFailure
  onRetry: () => void | Promise<void>
  refreshing: boolean
  runtimeCapabilities: RuntimeCapabilitiesSnapshot | null
}) {
  const includedCapabilities = runtimeCapabilities?.items.filter((item) => item.kind === 'included') ?? []
  const optionalCapabilities = runtimeCapabilities?.items.filter((item) => item.kind === 'optional') ?? []

  return <Tabs.Content asChild value="compatibility">
    <section className={settingsStyles.panel}>
      <div className={settingsStyles.panelHeading}>
        <Cpu aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
        <div className={settingsStyles.panelHeadingCopy}>
          <h2 className={settingsStyles.panelTitle}>Compatibilità del sistema</h2>
          <p className={settingsStyles.panelDescription}>Distingue i componenti inclusi nell’app dagli strumenti esterni opzionali.</p>
        </div>
      </div>
      <SettingsSectionError failure={failure} fallbackRecovery={{ label: 'Riprova', run: onRetry, pendingLabel: 'Nuovo tentativo…' }} />
      {!failure && runtimeCapabilities && <div className={settingsStyles.capabilityGroups}>
        <section className={settingsStyles.capabilityGroup} aria-labelledby="included-capabilities-title">
          <div className={settingsStyles.groupHeading}>
            <h3 className={settingsStyles.groupTitle} id="included-capabilities-title">Inclusi in VincodeLab</h3>
            <p className={settingsStyles.groupDescription}>Non richiedono Node, npm o client database installati sul computer.</p>
          </div>
          <ul className={settingsStyles.capabilityList}>{includedCapabilities.map((capability) => <CapabilityItem capability={capability} key={capability.id} />)}</ul>
        </section>
        <section className={settingsStyles.capabilityGroup} aria-labelledby="optional-capabilities-title">
          <div className={settingsStyles.groupHeading}>
            <h3 className={settingsStyles.groupTitle} id="optional-capabilities-title">Strumenti opzionali</h3>
            <p className={settingsStyles.groupDescription}>Se mancano, viene disattivata soltanto la funzione che li utilizza.</p>
          </div>
          <ul className={settingsStyles.capabilityList}>{optionalCapabilities.map((capability) => <CapabilityItem capability={capability} key={capability.id} />)}</ul>
        </section>
      </div>}
      {!failure && !runtimeCapabilities && <p className={settingsStyles.empty}>{refreshing ? 'Verifica compatibilità in corso…' : 'Compatibilità non ancora verificata.'}</p>}
    </section>
  </Tabs.Content>
}
