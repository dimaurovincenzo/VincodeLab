import { useMemo } from 'react'
import { Check, FilePlus2, Trash2 } from 'lucide-react'
import type { PiPackageSkill, ProjectSkill } from '@/bridge'
import { Button, createListCollection, Field, IconButton, Listbox, Spinner, Tabs } from '@/components/ui'
import { SKILL_NAME_HELP, SKILL_NAME_MAX_LENGTH } from '@/lib/skill-name'
import { settingsStyles } from '@/theme/styles/settings'
import type { SystemSkillsController } from '../hooks/use-system-skills'
import type { SettingsSectionFailure } from '../model/settings.types'
import { SettingsSectionError } from './settings-section-error'

export function SkillsSettingsSection({
  controller,
  failure,
  onRetry,
  packageSkills,
  skills,
}: {
  controller: SystemSkillsController
  failure?: SettingsSectionFailure
  onRetry: () => void | Promise<void>
  packageSkills: PiPackageSkill[]
  skills: ProjectSkill[]
}) {
  const {
    changeSelectedSkillContent,
    changeSkillName,
    requestCreateSystemSkill,
    requestDeleteSystemSkill,
    requestSelectSystemSkill,
    saveSystemSkill,
    selectedSkill,
    skillEditorFailure,
    skillName,
    skillNameError,
    skillNameFailure,
    systemSkillBusy,
    systemSkillHasUnsavedChanges,
    systemSkillName,
    systemSkillSaving,
  } = controller
  const systemSkillCollection = useMemo(() => createListCollection({
    items: skills,
    itemToString: (skill) => skill.name,
    itemToValue: (skill) => skill.id,
  }), [skills])

  return <Tabs.Content asChild value="skills">
    <section className={settingsStyles.panel}>
      <div className={settingsStyles.panelHeading}>
        <FilePlus2 aria-hidden="true" className={settingsStyles.panelHeadingIcon} />
        <div className={settingsStyles.panelHeadingCopy}>
          <h2 className={settingsStyles.panelTitle}>Skill Pi</h2>
          <p className={settingsStyles.panelDescription}>Catalogo delle sole risorse Pi, senza percorsi Codex.</p>
        </div>
      </div>
      <SettingsSectionError failure={failure} fallbackRecovery={{ label: 'Riprova', run: onRetry, pendingLabel: 'Nuovo tentativo…' }} />

      <section className={settingsStyles.skillGroup}>
        <div className={settingsStyles.groupHeading}>
          <h3 className={settingsStyles.groupTitle} id="system-skills-list-label">Manuali</h3>
          <p className={settingsStyles.groupDescription}>Disponibili in <code>~/.pi/agent/skills</code> e modificabili dall’app.</p>
        </div>
        <div className={settingsStyles.form}>
          <Field.Root invalid={Boolean(skillNameError || skillNameFailure)}><Field.Input aria-describedby="system-skill-name-help" aria-label="Nome skill Pi" autoCapitalize="none" disabled={Boolean(systemSkillBusy)} maxLength={SKILL_NAME_MAX_LENGTH} spellCheck={false} value={skillName} onChange={(event) => changeSkillName(event.target.value)} placeholder="es. revisione-codice" />
            {skillNameError
              ? <Field.ErrorText id="system-skill-name-help">{skillNameError}</Field.ErrorText>
              : skillNameFailure
                ? <Field.ErrorText id="system-skill-name-help">{skillNameFailure.title}. {skillNameFailure.description} Riferimento {skillNameFailure.correlationId}.</Field.ErrorText>
                : <Field.HelperText id="system-skill-name-help">{SKILL_NAME_HELP}</Field.HelperText>}
          </Field.Root>
          <Button size="sm" disabled={Boolean(systemSkillBusy) || !systemSkillName || Boolean(skillNameError)} onClick={requestCreateSystemSkill}>
            {systemSkillBusy === 'create' && <Spinner size={14} />}
            {systemSkillBusy === 'create' ? 'Creazione…' : skillNameFailure ? 'Riprova creazione' : 'Crea skill'}
          </Button>
        </div>
        {skills.length ? <div className={settingsStyles.skillList}>
          <Listbox.Root collection={systemSkillCollection} deselectable={false} ids={{ label: 'system-skills-list-label' }} loopFocus selectionMode="single" value={selectedSkill ? [selectedSkill.id] : []} onValueChange={({ value }) => { const skillId = value[0]; if (skillId) requestSelectSystemSkill(skillId) }}>
            <Listbox.Content className={settingsStyles.skillListbox}>
              {skills.map((skill) => <Listbox.Item className={settingsStyles.skillItem} highlightOnHover item={skill} key={skill.id}>
                <Listbox.ItemText asChild>
                  <span className={settingsStyles.skillItemText}>
                    <strong className={settingsStyles.skillItemTitle}>{skill.name}</strong>
                    <small className={settingsStyles.skillItemDescription}>{skill.description || 'Descrizione mancante'}</small>
                  </span>
                </Listbox.ItemText>
                <Listbox.ItemIndicator><Check aria-hidden="true" size={14} /></Listbox.ItemIndicator>
              </Listbox.Item>)}
            </Listbox.Content>
          </Listbox.Root>
          <div className={settingsStyles.skillDeleteActions}>{skills.map((skill) => <span className={settingsStyles.skillDeleteAction} key={skill.id}><IconButton disabled={Boolean(systemSkillBusy)} tone="danger" tooltip={`Elimina ${skill.name}`} variant="subtle" onClick={() => requestDeleteSystemSkill(skill)}><Trash2 aria-hidden="true" size={14} /></IconButton></span>)}</div>
        </div> : <p className={settingsStyles.empty}>Nessuna skill manuale.</p>}
      </section>

      <section className={`${settingsStyles.skillGroup} ${settingsStyles.separatedSkillGroup}`}>
        <div className={settingsStyles.groupHeading}>
          <h3 className={settingsStyles.groupTitle}>Da pacchetti Pi</h3>
          <p className={settingsStyles.groupDescription}>Rilevate dai pacchetti npm e Git installati per Pi. Sono in sola lettura.</p>
        </div>
        {packageSkills.length ? <ul className={settingsStyles.list}>
          {packageSkills.map((skill) => <li className={settingsStyles.listItem} key={skill.id}>
            <div className={settingsStyles.packageSkillBody}>
              <strong className={settingsStyles.packageSkillTitle}>{skill.name}</strong>
              <small className={settingsStyles.packageSkillDescription}>{skill.description || 'Descrizione mancante'}</small>
              {!skill.valid && <small className={`${settingsStyles.packageSkillDescription} ${settingsStyles.skillWarning}`}>La skill non può essere usata. Controlla o aggiorna il pacchetto di origine.</small>}
              <code className={settingsStyles.packageSkillSource} title={skill.source}>{skill.source}</code>
            </div>
          </li>)}
        </ul> : <p className={settingsStyles.empty}>Nessuna skill rilevata dai pacchetti Pi.</p>}
      </section>

      {selectedSkill && <div className={settingsStyles.skillEditor}>
        <div className={settingsStyles.skillEditorHeader}>
          <h3 className={settingsStyles.skillEditorTitle}>{selectedSkill.name}</h3>
          <span className={settingsStyles.skillEditorDescription}>Modifica il contenuto della skill Pi selezionata.</span>
        </div>
        <Field.Root className={settingsStyles.skillEditorField} invalid={Boolean(skillEditorFailure)}>
          <Field.Textarea aria-label={`Contenuto skill ${selectedSkill.name}`} disabled={systemSkillSaving} value={selectedSkill.content ?? ''} onChange={(event) => changeSelectedSkillContent(event.target.value)} />
          {skillEditorFailure && <Field.ErrorText>{skillEditorFailure.title}. {skillEditorFailure.description} Riferimento {skillEditorFailure.correlationId}.</Field.ErrorText>}
        </Field.Root>
        <Button size="sm" disabled={systemSkillSaving || !systemSkillHasUnsavedChanges} onClick={() => void saveSystemSkill()}>
          {systemSkillSaving && <Spinner size={14} />}
          {systemSkillSaving ? 'Salvataggio…' : skillEditorFailure ? 'Riprova salvataggio' : 'Salva modifiche'}
        </Button>
      </div>}
    </section>
  </Tabs.Content>
}
