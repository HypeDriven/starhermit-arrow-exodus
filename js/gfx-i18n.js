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

/* StarHermit account strings (title screen sign-in, invite, sync line).
 * `{name}` is the player's display name. */
const P_EN = {
  signIn: 'Sign in with StarHermit', invite: 'Invite a friend',
  inviteCopied: 'Invite link copied to the clipboard.', inviteFailed: 'Could not copy the invite link.',
  offline: 'Offline — progress is stored on this device.', playingAs: 'Playing as {name}',
  synced: 'progress synced', saving: 'saving…', syncOff: 'cloud sync unavailable',
  signedOut: 'Signed out of StarHermit — progress stays on this device.',
  lbPosting: 'Posting score to the leaderboard…', lbRank: 'Leaderboard rank: #{rank}',
  lbPosted: 'Score posted to the leaderboard.', lbNotPosted: 'Score not posted to the leaderboard.',
};
const P_ES = {
  signIn: 'Iniciar sesión con StarHermit', invite: 'Invitar a un amigo',
  inviteCopied: 'Enlace de invitación copiado al portapapeles.', inviteFailed: 'No se pudo copiar el enlace de invitación.',
  offline: 'Sin conexión: el progreso se guarda en este dispositivo.', playingAs: 'Jugando como {name}',
  synced: 'progreso sincronizado', saving: 'guardando…', syncOff: 'sincronización en la nube no disponible',
  signedOut: 'Sesión de StarHermit cerrada: el progreso se queda en este dispositivo.',
  lbPosting: 'Enviando la puntuación a la clasificación…', lbRank: 'Puesto en la clasificación: #{rank}',
  lbPosted: 'Puntuación enviada a la clasificación.', lbNotPosted: 'La puntuación no se envió a la clasificación.',
};
const P_FR = {
  signIn: 'Se connecter avec StarHermit', invite: 'Inviter un ami',
  inviteCopied: 'Lien d’invitation copié dans le presse-papiers.', inviteFailed: 'Impossible de copier le lien d’invitation.',
  offline: 'Hors ligne : la progression est enregistrée sur cet appareil.', playingAs: 'Vous jouez en tant que {name}',
  synced: 'progression synchronisée', saving: 'enregistrement…', syncOff: 'synchronisation cloud indisponible',
  signedOut: 'Déconnecté de StarHermit : la progression reste sur cet appareil.',
  lbPosting: 'Envoi du score au classement…', lbRank: 'Rang au classement : #{rank}',
  lbPosted: 'Score envoyé au classement.', lbNotPosted: 'Score non envoyé au classement.',
};
export const PLATFORM_STRINGS = {
  'en-US': P_EN,
  'en-GB': P_EN,
  'es-419': P_ES,
  'es-ES': Object.assign({}, P_ES, { inviteCopied: 'Enlace de invitación copiado en el portapapeles.' }),
  'de-DE': {
    signIn: 'Mit StarHermit anmelden', invite: 'Freund einladen',
    inviteCopied: 'Einladungslink in die Zwischenablage kopiert.', inviteFailed: 'Einladungslink konnte nicht kopiert werden.',
    offline: 'Offline – der Fortschritt wird auf diesem Gerät gespeichert.', playingAs: 'Du spielst als {name}',
    synced: 'Fortschritt synchronisiert', saving: 'wird gespeichert …', syncOff: 'Cloud-Synchronisierung nicht verfügbar',
    signedOut: 'Von StarHermit abgemeldet – der Fortschritt bleibt auf diesem Gerät.',
    lbPosting: 'Punktzahl wird an die Bestenliste gesendet …', lbRank: 'Platz in der Bestenliste: #{rank}',
    lbPosted: 'Punktzahl an die Bestenliste gesendet.', lbNotPosted: 'Punktzahl wurde nicht an die Bestenliste gesendet.',
  },
  'fr-FR': P_FR,
  'fr-CA': Object.assign({}, P_FR, { syncOff: 'synchronisation infonuagique indisponible' }),
  'pt-BR': {
    signIn: 'Entrar com a StarHermit', invite: 'Convidar um amigo',
    inviteCopied: 'Link de convite copiado para a área de transferência.', inviteFailed: 'Não foi possível copiar o link de convite.',
    offline: 'Offline — o progresso fica salvo neste dispositivo.', playingAs: 'Jogando como {name}',
    synced: 'progresso sincronizado', saving: 'salvando…', syncOff: 'sincronização na nuvem indisponível',
    signedOut: 'Você saiu da StarHermit — o progresso continua neste dispositivo.',
    lbPosting: 'Enviando a pontuação para o ranking…', lbRank: 'Posição no ranking: #{rank}',
    lbPosted: 'Pontuação enviada para o ranking.', lbNotPosted: 'A pontuação não foi enviada para o ranking.',
  },
  'it-IT': {
    signIn: 'Accedi con StarHermit', invite: 'Invita un amico',
    inviteCopied: 'Link di invito copiato negli appunti.', inviteFailed: 'Impossibile copiare il link di invito.',
    offline: 'Offline: i progressi sono salvati su questo dispositivo.', playingAs: 'Stai giocando come {name}',
    synced: 'progressi sincronizzati', saving: 'salvataggio…', syncOff: 'sincronizzazione cloud non disponibile',
    signedOut: 'Disconnesso da StarHermit: i progressi restano su questo dispositivo.',
    lbPosting: 'Invio del punteggio alla classifica…', lbRank: 'Posizione in classifica: #{rank}',
    lbPosted: 'Punteggio inviato alla classifica.', lbNotPosted: 'Punteggio non inviato alla classifica.',
  },
};

/** Account strings for a BCP-47 tag (same fallback rules as gfxStrings). */
export function platformStrings(locale) {
  const tag = String(locale || 'en-US');
  if (PLATFORM_STRINGS[tag]) return PLATFORM_STRINGS[tag];
  const lang = tag.split('-')[0].toLowerCase();
  const first = { en: 'en-US', es: 'es-419', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR', it: 'it-IT' }[lang];
  return PLATFORM_STRINGS[first] || PLATFORM_STRINGS['en-US'];
}
