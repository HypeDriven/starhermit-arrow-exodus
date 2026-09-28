/* Arrow Exodus — strings for the Graphics settings section, in every
 * required locale. The rest of the game is English-only (spec §10); this
 * table is picked from navigator.language and falls back to en-US.
 * `{tier}` is replaced by a translated tier name.
 */
const en = {
  section: 'Graphics', quality: 'Quality', auto: 'Auto (detected: {tier})',
  renderScale: 'Render scale', fromPreset: 'From preset ({tier})',
  adaptive: 'Adaptive resolution', showFps: 'Show frame rate',
  postFailed: 'Post-processing is unavailable on this device, so the plate renders without it.',
  cat: { shadows: 'Shadows', ao: 'Ambient occlusion', bloom: 'Bloom', grade: 'Color grade',
    antialias: 'Anti-aliasing', reflections: 'Reflections', detail: 'Surface detail',
    particles: 'Sparks', background: 'Ambient motion' },
  tier: { low: 'Low', balanced: 'Balanced', high: 'High', ultra: 'Ultra', off: 'Off', on: 'On',
    medium: 'Medium', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Plain', detailed: 'Detailed',
    static: 'Static', animated: 'Animated' },
  cost: { noShadows: 'no shadows', shadows: 'shadows', reflections: 'reflections', ao: 'ambient occlusion',
    aoHigh: 'full ambient occlusion', bloom: 'bloom', noAA: 'no anti-aliasing' },
};

const es = {
  section: 'Gráficos', quality: 'Calidad', auto: 'Automática (detectada: {tier})',
  renderScale: 'Escala de renderizado', fromPreset: 'Según el ajuste ({tier})',
  adaptive: 'Resolución adaptable', showFps: 'Mostrar fotogramas por segundo',
  postFailed: 'El posprocesado no está disponible en este dispositivo; la placa se muestra sin él.',
  cat: { shadows: 'Sombras', ao: 'Oclusión ambiental', bloom: 'Resplandor', grade: 'Corrección de color',
    antialias: 'Suavizado de bordes', reflections: 'Reflejos', detail: 'Detalle de superficies',
    particles: 'Chispas', background: 'Movimiento ambiental' },
  tier: { low: 'Baja', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', off: 'No', on: 'Sí',
    medium: 'Media', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Detallado',
    static: 'Estático', animated: 'Animado' },
  cost: { noShadows: 'sin sombras', shadows: 'sombras', reflections: 'reflejos', ao: 'oclusión ambiental',
    aoHigh: 'oclusión ambiental completa', bloom: 'resplandor', noAA: 'sin suavizado' },
};

const fr = {
  section: 'Graphismes', quality: 'Qualité', auto: 'Auto (détectée : {tier})',
  renderScale: 'Échelle de rendu', fromPreset: 'Selon le préréglage ({tier})',
  adaptive: 'Résolution adaptative', showFps: 'Afficher les images par seconde',
  postFailed: 'Le post-traitement est indisponible sur cet appareil ; la plaque s’affiche sans.',
  cat: { shadows: 'Ombres', ao: 'Occlusion ambiante', bloom: 'Halo lumineux', grade: 'Étalonnage des couleurs',
    antialias: 'Anticrénelage', reflections: 'Reflets', detail: 'Détail des surfaces',
    particles: 'Étincelles', background: 'Mouvement d’ambiance' },
  tier: { low: 'Basse', balanced: 'Équilibrée', high: 'Haute', ultra: 'Ultra', off: 'Non', on: 'Oui',
    medium: 'Moyenne', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simple', detailed: 'Détaillé',
    static: 'Statique', animated: 'Animé' },
  cost: { noShadows: 'sans ombres', shadows: 'ombres', reflections: 'reflets', ao: 'occlusion ambiante',
    aoHigh: 'occlusion ambiante complète', bloom: 'halo', noAA: 'sans anticrénelage' },
};

export const GFX_STRINGS = {
  'en-US': en,
  'en-GB': Object.assign({}, en, { cat: Object.assign({}, en.cat, { grade: 'Colour grade' }) }),
  'es-419': es,
  'es-ES': Object.assign({}, es, { showFps: 'Mostrar FPS' }),
  'de-DE': {
    section: 'Grafik', quality: 'Qualität', auto: 'Automatisch (erkannt: {tier})',
    renderScale: 'Renderskalierung', fromPreset: 'Laut Voreinstellung ({tier})',
    adaptive: 'Adaptive Auflösung', showFps: 'Bildrate anzeigen',
    postFailed: 'Nachbearbeitung ist auf diesem Gerät nicht verfügbar; die Platte wird ohne sie dargestellt.',
    cat: { shadows: 'Schatten', ao: 'Umgebungsverdeckung', bloom: 'Leuchteffekt', grade: 'Farbkorrektur',
      antialias: 'Kantenglättung', reflections: 'Spiegelungen', detail: 'Oberflächendetails',
      particles: 'Funken', background: 'Umgebungsbewegung' },
    tier: { low: 'Niedrig', balanced: 'Ausgewogen', high: 'Hoch', ultra: 'Ultra', off: 'Aus', on: 'An',
      medium: 'Mittel', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Schlicht', detailed: 'Detailliert',
      static: 'Statisch', animated: 'Animiert' },
    cost: { noShadows: 'keine Schatten', shadows: 'Schatten', reflections: 'Spiegelungen', ao: 'Umgebungsverdeckung',
      aoHigh: 'volle Umgebungsverdeckung', bloom: 'Leuchteffekt', noAA: 'keine Kantenglättung' },
  },
  'fr-FR': fr,
  'fr-CA': Object.assign({}, fr, { showFps: 'Afficher la fréquence d’images' }),
  'pt-BR': {
    section: 'Gráficos', quality: 'Qualidade', auto: 'Automática (detectada: {tier})',
    renderScale: 'Escala de renderização', fromPreset: 'Conforme a predefinição ({tier})',
    adaptive: 'Resolução adaptável', showFps: 'Mostrar taxa de quadros',
    postFailed: 'O pós-processamento não está disponível neste dispositivo; a placa é exibida sem ele.',
    cat: { shadows: 'Sombras', ao: 'Oclusão de ambiente', bloom: 'Brilho', grade: 'Correção de cor',
      antialias: 'Antisserrilhado', reflections: 'Reflexos', detail: 'Detalhe das superfícies',
      particles: 'Faíscas', background: 'Movimento ambiente' },
    tier: { low: 'Baixa', balanced: 'Equilibrada', high: 'Alta', ultra: 'Ultra', off: 'Não', on: 'Sim',
      medium: 'Média', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Simples', detailed: 'Detalhado',
      static: 'Estático', animated: 'Animado' },
    cost: { noShadows: 'sem sombras', shadows: 'sombras', reflections: 'reflexos', ao: 'oclusão de ambiente',
      aoHigh: 'oclusão de ambiente completa', bloom: 'brilho', noAA: 'sem antisserrilhado' },
  },
  'it-IT': {
    section: 'Grafica', quality: 'Qualità', auto: 'Automatica (rilevata: {tier})',
    renderScale: 'Scala di rendering', fromPreset: 'Dal preset ({tier})',
    adaptive: 'Risoluzione adattiva', showFps: 'Mostra frequenza fotogrammi',
    postFailed: 'La post-elaborazione non è disponibile su questo dispositivo; la piastra viene mostrata senza.',
    cat: { shadows: 'Ombre', ao: 'Occlusione ambientale', bloom: 'Bagliore', grade: 'Correzione colore',
      antialias: 'Antialiasing', reflections: 'Riflessi', detail: 'Dettaglio superfici',
      particles: 'Scintille', background: 'Movimento ambientale' },
    tier: { low: 'Bassa', balanced: 'Bilanciata', high: 'Alta', ultra: 'Ultra', off: 'No', on: 'Sì',
      medium: 'Media', fxaa: 'FXAA', smaa: 'SMAA', msaa: 'MSAA', plain: 'Semplice', detailed: 'Dettagliato',
      static: 'Statico', animated: 'Animato' },
    cost: { noShadows: 'nessuna ombra', shadows: 'ombre', reflections: 'riflessi', ao: 'occlusione ambientale',
      aoHigh: 'occlusione ambientale completa', bloom: 'bagliore', noAA: 'nessun antialiasing' },
  },
};

/** Strings for a BCP-47 tag: exact match, then same language (es → es-419), else en-US. */
export function gfxStrings(locale) {
  const tag = String(locale || 'en-US');
  if (GFX_STRINGS[tag]) return GFX_STRINGS[tag];
  const lang = tag.split('-')[0].toLowerCase();
  const first = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' }[lang];
  return GFX_STRINGS[first] || GFX_STRINGS['en-US'];
}
