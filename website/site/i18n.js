/* =============================================================
   EasyClaw — Lightweight i18n for static site
   Auto-detects browser language. Falls back to English.
   ============================================================= */

const translations = {
  en: {
    "nav.features": "Features",
    "nav.download": "Download",
    "nav.requirements": "Requirements",
    "hero.title": "Desktop Runtime Manager<br>for OpenClaw",
    "hero.subtitle":
      "EasyClaw gives you a local tray app to manage your OpenClaw gateway, configure rules and permissions, and keep everything running smoothly &mdash; without touching the command line.",
    "hero.download": "Download Now",
    "hero.github": "View on GitHub",
    "features.title": "Features",
    "features.tray.title": "Tray App Control",
    "features.tray.desc":
      "Start, stop, and restart your OpenClaw gateway from the system tray. No terminal required.",
    "features.panel.title": "Local Management Panel",
    "features.panel.desc":
      "A browser-based panel running on localhost for configuring rules, channels, and permissions.",
    "features.rules.title": "Rules & Guards",
    "features.rules.desc":
      "Define policies and guards that take effect immediately &mdash; no gateway restart needed.",
    "features.secrets.title": "Secure Secrets",
    "features.secrets.desc":
      "API keys stored in macOS Keychain or Windows DPAPI. Never written to plaintext config files.",
    "features.skill.title": "Visual Permission Control",
    "features.skill.desc":
      "Set granular access rules for folders and files without editing complex configuration files.",
    "features.update.title": "Auto-Updates",
    "features.update.desc":
      "Built-in update checker notifies you when a new version is available. One-click download.",
    "download.title": "Download EasyClaw",
    "download.version": "Version",
    "download.mac.btn": "Download .dmg",
    "download.win.btn": "Download .exe",
    "download.note":
      'Verify your download by comparing the SHA-256 hash above with the output of <code>shasum -a 256</code> (macOS/Linux) or <code>Get-FileHash</code> (PowerShell).',
    "requirements.title": "System Requirements",
    "requirements.mac.os": "macOS 12 (Monterey) or later",
    "requirements.mac.arch": "Apple Silicon (M1+) or Intel",
    "requirements.mac.disk": "200 MB disk space",
    "requirements.win.os": "Windows 10 (version 1903+) or later",
    "requirements.win.arch": "x64 architecture",
    "requirements.win.disk": "200 MB disk space",
    "footer.text": "&copy; 2026 EasyClaw. Open source on",
  },
  zh: {
    "nav.features": "功能",
    "nav.download": "下载",
    "nav.requirements": "系统要求",
    "hero.title": "OpenClaw 桌面运行时管理器",
    "hero.subtitle":
      "爪爪提供一个本地托盘应用，用于管理 OpenClaw 网关、配置规则和权限，让一切平稳运行——无需命令行操作。",
    "hero.download": "立即下载",
    "hero.github": "在 GitHub 上查看",
    "features.title": "功能特性",
    "features.tray.title": "托盘控制",
    "features.tray.desc":
      "从系统托盘启动、停止和重启 OpenClaw 网关，无需终端。",
    "features.panel.title": "本地管理面板",
    "features.panel.desc":
      "基于浏览器的本地面板，用于配置规则、渠道和权限。",
    "features.rules.title": "规则和守卫",
    "features.rules.desc":
      "定义策略和守卫，立即生效——无需重启网关。",
    "features.secrets.title": "安全密钥存储",
    "features.secrets.desc":
      "API 密钥存储在 macOS 钥匙串或 Windows DPAPI 中，绝不以明文写入配置文件。",
    "features.skill.title": "可视化权限控制",
    "features.skill.desc":
      "可视化设置文件夹和文件的精细访问权限，无需编辑复杂的配置文件。",
    "features.update.title": "自动更新",
    "features.update.desc":
      "内置更新检查器，新版本可用时通知您，一键下载。",
    "download.title": "下载爪爪",
    "download.version": "版本",
    "download.mac.btn": "下载 .dmg",
    "download.win.btn": "下载 .exe",
    "download.note":
      '通过将上方的 SHA-256 哈希与 <code>shasum -a 256</code>（macOS/Linux）或 <code>Get-FileHash</code>（PowerShell）的输出进行比较来验证下载。',
    "requirements.title": "系统要求",
    "requirements.mac.os": "macOS 12 (Monterey) 或更高版本",
    "requirements.mac.arch": "Apple Silicon (M1+) 或 Intel",
    "requirements.mac.disk": "200 MB 磁盘空间",
    "requirements.win.os": "Windows 10（1903+）或更高版本",
    "requirements.win.arch": "x64 架构",
    "requirements.win.disk": "200 MB 磁盘空间",
    "footer.text": "&copy; 2026 爪爪。开源于",
  },
  ja: {
    "nav.features": "機能",
    "nav.download": "ダウンロード",
    "nav.requirements": "動作環境",
    "hero.title": "OpenClaw デスクトップランタイムマネージャー",
    "hero.subtitle":
      "EasyClaw は OpenClaw ゲートウェイの管理、ルールや権限の設定を行うローカルトレイアプリです。コマンドライン不要で、すべてをスムーズに稼働させます。",
    "hero.download": "今すぐダウンロード",
    "hero.github": "GitHub で見る",
    "features.title": "機能一覧",
    "features.tray.title": "トレイアプリ操作",
    "features.tray.desc":
      "システムトレイから OpenClaw ゲートウェイの起動・停止・再起動が可能。ターミナル不要。",
    "features.panel.title": "ローカル管理パネル",
    "features.panel.desc":
      "localhost で動作するブラウザベースのパネルで、ルール・チャンネル・権限を設定。",
    "features.rules.title": "ルールとガード",
    "features.rules.desc":
      "ポリシーとガードを定義し、即座に反映。ゲートウェイの再起動は不要。",
    "features.secrets.title": "セキュアなシークレット管理",
    "features.secrets.desc":
      "API キーは macOS キーチェーンまたは Windows DPAPI に保存。平文の設定ファイルには書き込まれません。",
    "features.skill.title": "ビジュアル権限管理",
    "features.skill.desc":
      "複雑な設定ファイルを編集せずに、フォルダやファイルのきめ細かいアクセスルールを設定できます。",
    "features.update.title": "自動アップデート",
    "features.update.desc":
      "内蔵のアップデートチェッカーが新バージョンを通知。ワンクリックでダウンロード。",
    "download.title": "EasyClaw をダウンロード",
    "download.version": "バージョン",
    "download.mac.btn": ".dmg をダウンロード",
    "download.win.btn": ".exe をダウンロード",
    "download.note":
      'ダウンロードの検証：上記の SHA-256 ハッシュを <code>shasum -a 256</code>（macOS/Linux）または <code>Get-FileHash</code>（PowerShell）の出力と比較してください。',
    "requirements.title": "動作環境",
    "requirements.mac.os": "macOS 12 (Monterey) 以降",
    "requirements.mac.arch": "Apple Silicon (M1+) または Intel",
    "requirements.mac.disk": "200 MB のディスク空き容量",
    "requirements.win.os": "Windows 10（1903+）以降",
    "requirements.win.arch": "x64 アーキテクチャ",
    "requirements.win.disk": "200 MB のディスク空き容量",
    "footer.text": "&copy; 2026 EasyClaw。オープンソース：",
  },
  fr: {
    "nav.features": "Fonctionnalités",
    "nav.download": "Télécharger",
    "nav.requirements": "Configuration requise",
    "hero.title": "Gestionnaire de bureau<br>pour OpenClaw",
    "hero.subtitle":
      "EasyClaw vous offre une application de barre des tâches pour gérer votre passerelle OpenClaw, configurer les règles et les permissions, et maintenir le bon fonctionnement &mdash; sans toucher à la ligne de commande.",
    "hero.download": "Télécharger",
    "hero.github": "Voir sur GitHub",
    "features.title": "Fonctionnalités",
    "features.tray.title": "Contrôle via la barre des tâches",
    "features.tray.desc":
      "Démarrez, arrêtez et redémarrez votre passerelle OpenClaw depuis la barre des tâches. Aucun terminal requis.",
    "features.panel.title": "Panneau de gestion local",
    "features.panel.desc":
      "Un panneau basé sur le navigateur fonctionnant sur localhost pour configurer les règles, canaux et permissions.",
    "features.rules.title": "Règles et gardes",
    "features.rules.desc":
      "Définissez des politiques et des gardes qui prennent effet immédiatement &mdash; sans redémarrage de la passerelle.",
    "features.secrets.title": "Secrets sécurisés",
    "features.secrets.desc":
      "Les clés API sont stockées dans le trousseau macOS ou Windows DPAPI. Jamais écrites en clair dans les fichiers de configuration.",
    "features.skill.title": "Contrôle visuel des permissions",
    "features.skill.desc":
      "Définissez des règles d'accès granulaires pour les dossiers et fichiers sans éditer de fichiers de configuration complexes.",
    "features.update.title": "Mises à jour automatiques",
    "features.update.desc":
      "Vérificateur de mises à jour intégré qui vous notifie quand une nouvelle version est disponible. Téléchargement en un clic.",
    "download.title": "Télécharger EasyClaw",
    "download.version": "Version",
    "download.mac.btn": "Télécharger .dmg",
    "download.win.btn": "Télécharger .exe",
    "download.note":
      'Vérifiez votre téléchargement en comparant le hash SHA-256 ci-dessus avec la sortie de <code>shasum -a 256</code> (macOS/Linux) ou <code>Get-FileHash</code> (PowerShell).',
    "requirements.title": "Configuration requise",
    "requirements.mac.os": "macOS 12 (Monterey) ou ultérieur",
    "requirements.mac.arch": "Apple Silicon (M1+) ou Intel",
    "requirements.mac.disk": "200 Mo d'espace disque",
    "requirements.win.os": "Windows 10 (version 1903+) ou ultérieur",
    "requirements.win.arch": "Architecture x64",
    "requirements.win.disk": "200 Mo d'espace disque",
    "footer.text": "&copy; 2026 EasyClaw. Open source sur",
  },
  de: {
    "nav.features": "Funktionen",
    "nav.download": "Herunterladen",
    "nav.requirements": "Systemanforderungen",
    "hero.title": "Desktop-Laufzeitmanager<br>für OpenClaw",
    "hero.subtitle":
      "EasyClaw bietet Ihnen eine lokale Tray-App zur Verwaltung Ihres OpenClaw-Gateways, zur Konfiguration von Regeln und Berechtigungen und zum reibungslosen Betrieb &mdash; ganz ohne Kommandozeile.",
    "hero.download": "Jetzt herunterladen",
    "hero.github": "Auf GitHub ansehen",
    "features.title": "Funktionen",
    "features.tray.title": "Tray-App-Steuerung",
    "features.tray.desc":
      "Starten, stoppen und starten Sie Ihr OpenClaw-Gateway über das System-Tray neu. Kein Terminal erforderlich.",
    "features.panel.title": "Lokales Verwaltungspanel",
    "features.panel.desc":
      "Ein browserbasiertes Panel auf localhost zur Konfiguration von Regeln, Kanälen und Berechtigungen.",
    "features.rules.title": "Regeln und Wächter",
    "features.rules.desc":
      "Definieren Sie Richtlinien und Wächter, die sofort wirksam werden &mdash; kein Gateway-Neustart erforderlich.",
    "features.secrets.title": "Sichere Schlüssel",
    "features.secrets.desc":
      "API-Schlüssel werden im macOS-Schlüsselbund oder Windows DPAPI gespeichert. Niemals im Klartext in Konfigurationsdateien.",
    "features.skill.title": "Visuelle Berechtigungskontrolle",
    "features.skill.desc":
      "Legen Sie granulare Zugriffsregeln für Ordner und Dateien fest, ohne komplexe Konfigurationsdateien zu bearbeiten.",
    "features.update.title": "Automatische Updates",
    "features.update.desc":
      "Integrierter Update-Checker benachrichtigt Sie bei neuen Versionen. Download mit einem Klick.",
    "download.title": "EasyClaw herunterladen",
    "download.version": "Version",
    "download.mac.btn": ".dmg herunterladen",
    "download.win.btn": ".exe herunterladen",
    "download.note":
      'Überprüfen Sie Ihren Download, indem Sie den obigen SHA-256-Hash mit der Ausgabe von <code>shasum -a 256</code> (macOS/Linux) oder <code>Get-FileHash</code> (PowerShell) vergleichen.',
    "requirements.title": "Systemanforderungen",
    "requirements.mac.os": "macOS 12 (Monterey) oder neuer",
    "requirements.mac.arch": "Apple Silicon (M1+) oder Intel",
    "requirements.mac.disk": "200 MB Speicherplatz",
    "requirements.win.os": "Windows 10 (Version 1903+) oder neuer",
    "requirements.win.arch": "x64-Architektur",
    "requirements.win.disk": "200 MB Speicherplatz",
    "footer.text": "&copy; 2026 EasyClaw. Open Source auf",
  },
  es: {
    "nav.features": "Características",
    "nav.download": "Descargar",
    "nav.requirements": "Requisitos",
    "hero.title": "Gestor de escritorio<br>para OpenClaw",
    "hero.subtitle":
      "EasyClaw te ofrece una aplicación de bandeja del sistema para gestionar tu gateway OpenClaw, configurar reglas y permisos, y mantener todo funcionando sin problemas &mdash; sin tocar la línea de comandos.",
    "hero.download": "Descargar ahora",
    "hero.github": "Ver en GitHub",
    "features.title": "Características",
    "features.tray.title": "Control desde la bandeja",
    "features.tray.desc":
      "Inicia, detén y reinicia tu gateway OpenClaw desde la bandeja del sistema. Sin terminal.",
    "features.panel.title": "Panel de gestión local",
    "features.panel.desc":
      "Un panel basado en navegador en localhost para configurar reglas, canales y permisos.",
    "features.rules.title": "Reglas y guardas",
    "features.rules.desc":
      "Define políticas y guardas que entran en vigor de inmediato &mdash; sin reiniciar el gateway.",
    "features.secrets.title": "Secretos seguros",
    "features.secrets.desc":
      "Las claves API se almacenan en el llavero de macOS o Windows DPAPI. Nunca se escriben en texto plano en archivos de configuración.",
    "features.skill.title": "Control visual de permisos",
    "features.skill.desc":
      "Configure reglas de acceso granulares para carpetas y archivos sin editar archivos de configuración complejos.",
    "features.update.title": "Actualizaciones automáticas",
    "features.update.desc":
      "Verificador de actualizaciones integrado que te notifica cuando hay una nueva versión. Descarga con un clic.",
    "download.title": "Descargar EasyClaw",
    "download.version": "Versión",
    "download.mac.btn": "Descargar .dmg",
    "download.win.btn": "Descargar .exe",
    "download.note":
      'Verifica tu descarga comparando el hash SHA-256 de arriba con la salida de <code>shasum -a 256</code> (macOS/Linux) o <code>Get-FileHash</code> (PowerShell).',
    "requirements.title": "Requisitos del sistema",
    "requirements.mac.os": "macOS 12 (Monterey) o posterior",
    "requirements.mac.arch": "Apple Silicon (M1+) o Intel",
    "requirements.mac.disk": "200 MB de espacio en disco",
    "requirements.win.os": "Windows 10 (versión 1903+) o posterior",
    "requirements.win.arch": "Arquitectura x64",
    "requirements.win.disk": "200 MB de espacio en disco",
    "footer.text": "&copy; 2026 EasyClaw. Código abierto en",
  },
  th: {
    "nav.features": "คุณสมบัติ",
    "nav.download": "ดาวน์โหลด",
    "nav.requirements": "ความต้องการของระบบ",
    "hero.title": "ตัวจัดการรันไทม์เดสก์ท็อป<br>สำหรับ OpenClaw",
    "hero.subtitle":
      "EasyClaw มอบแอปถาดระบบท้องถิ่นสำหรับจัดการเกตเวย์ OpenClaw กำหนดค่ากฎและสิทธิ์ และทำให้ทุกอย่างทำงานได้อย่างราบรื่น &mdash; โดยไม่ต้องใช้บรรทัดคำสั่ง",
    "hero.download": "ดาวน์โหลดเลย",
    "hero.github": "ดูบน GitHub",
    "features.title": "คุณสมบัติ",
    "features.tray.title": "ควบคุมจากถาดระบบ",
    "features.tray.desc":
      "เริ่ม หยุด และรีสตาร์ทเกตเวย์ OpenClaw จากถาดระบบ ไม่ต้องใช้เทอร์มินัล",
    "features.panel.title": "แผงควบคุมท้องถิ่น",
    "features.panel.desc":
      "แผงควบคุมบนเบราว์เซอร์ที่ทำงานบน localhost สำหรับกำหนดค่ากฎ ช่องทาง และสิทธิ์",
    "features.rules.title": "กฎและการ์ด",
    "features.rules.desc":
      "กำหนดนโยบายและการ์ดที่มีผลทันที &mdash; ไม่ต้องรีสตาร์ทเกตเวย์",
    "features.secrets.title": "ความลับที่ปลอดภัย",
    "features.secrets.desc":
      "คีย์ API เก็บใน macOS Keychain หรือ Windows DPAPI ไม่เขียนเป็นข้อความธรรมดาในไฟล์กำหนดค่า",
    "features.skill.title": "การควบคุมสิทธิ์แบบภาพ",
    "features.skill.desc":
      "ตั้งค่ากฎการเข้าถึงแบบละเอียดสำหรับโฟลเดอร์และไฟล์โดยไม่ต้องแก้ไขไฟล์กำหนดค่าที่ซับซ้อน",
    "features.update.title": "อัปเดตอัตโนมัติ",
    "features.update.desc":
      "ตัวตรวจสอบอัปเดตในตัวแจ้งเตือนเมื่อมีเวอร์ชันใหม่ ดาวน์โหลดได้ในคลิกเดียว",
    "download.title": "ดาวน์โหลด EasyClaw",
    "download.version": "เวอร์ชัน",
    "download.mac.btn": "ดาวน์โหลด .dmg",
    "download.win.btn": "ดาวน์โหลด .exe",
    "download.note":
      'ตรวจสอบการดาวน์โหลดโดยเปรียบเทียบแฮช SHA-256 ด้านบนกับผลลัพธ์ของ <code>shasum -a 256</code> (macOS/Linux) หรือ <code>Get-FileHash</code> (PowerShell)',
    "requirements.title": "ความต้องการของระบบ",
    "requirements.mac.os": "macOS 12 (Monterey) หรือใหม่กว่า",
    "requirements.mac.arch": "Apple Silicon (M1+) หรือ Intel",
    "requirements.mac.disk": "พื้นที่ดิสก์ 200 MB",
    "requirements.win.os": "Windows 10 (เวอร์ชัน 1903+) หรือใหม่กว่า",
    "requirements.win.arch": "สถาปัตยกรรม x64",
    "requirements.win.disk": "พื้นที่ดิสก์ 200 MB",
    "footer.text": "&copy; 2026 EasyClaw โอเพนซอร์สบน",
  },
  ko: {
    "nav.features": "기능",
    "nav.download": "다운로드",
    "nav.requirements": "시스템 요구사항",
    "hero.title": "OpenClaw용<br>데스크톱 런타임 매니저",
    "hero.subtitle":
      "EasyClaw는 OpenClaw 게이트웨이를 관리하고, 규칙과 권한을 구성하며, 모든 것을 원활하게 운영할 수 있는 로컬 트레이 앱을 제공합니다 &mdash; 명령줄 없이.",
    "hero.download": "지금 다운로드",
    "hero.github": "GitHub에서 보기",
    "features.title": "기능",
    "features.tray.title": "트레이 앱 제어",
    "features.tray.desc":
      "시스템 트레이에서 OpenClaw 게이트웨이를 시작, 중지, 재시작하세요. 터미널이 필요 없습니다.",
    "features.panel.title": "로컬 관리 패널",
    "features.panel.desc":
      "localhost에서 실행되는 브라우저 기반 패널로 규칙, 채널, 권한을 구성합니다.",
    "features.rules.title": "규칙과 가드",
    "features.rules.desc":
      "정책과 가드를 정의하면 즉시 적용됩니다 &mdash; 게이트웨이 재시작이 필요 없습니다.",
    "features.secrets.title": "보안 시크릿",
    "features.secrets.desc":
      "API 키는 macOS 키체인 또는 Windows DPAPI에 저장됩니다. 일반 텍스트 설정 파일에 기록되지 않습니다.",
    "features.skill.title": "시각적 권한 제어",
    "features.skill.desc":
      "복잡한 구성 파일을 편집하지 않고도 폴더와 파일에 대한 세밀한 접근 규칙을 설정할 수 있습니다.",
    "features.update.title": "자동 업데이트",
    "features.update.desc":
      "내장 업데이트 체커가 새 버전을 알려줍니다. 원클릭 다운로드.",
    "download.title": "EasyClaw 다운로드",
    "download.version": "버전",
    "download.mac.btn": ".dmg 다운로드",
    "download.win.btn": ".exe 다운로드",
    "download.note":
      '위의 SHA-256 해시를 <code>shasum -a 256</code> (macOS/Linux) 또는 <code>Get-FileHash</code> (PowerShell)의 출력과 비교하여 다운로드를 확인하세요.',
    "requirements.title": "시스템 요구사항",
    "requirements.mac.os": "macOS 12 (Monterey) 이상",
    "requirements.mac.arch": "Apple Silicon (M1+) 또는 Intel",
    "requirements.mac.disk": "200 MB 디스크 공간",
    "requirements.win.os": "Windows 10 (버전 1903+) 이상",
    "requirements.win.arch": "x64 아키텍처",
    "requirements.win.disk": "200 MB 디스크 공간",
    "footer.text": "&copy; 2026 EasyClaw. 오픈소스:",
  },
  pt: {
    "nav.features": "Recursos",
    "nav.download": "Baixar",
    "nav.requirements": "Requisitos",
    "hero.title": "Gerenciador de desktop<br>para OpenClaw",
    "hero.subtitle":
      "O EasyClaw oferece um aplicativo de bandeja local para gerenciar seu gateway OpenClaw, configurar regras e permissões, e manter tudo funcionando perfeitamente &mdash; sem usar a linha de comando.",
    "hero.download": "Baixar agora",
    "hero.github": "Ver no GitHub",
    "features.title": "Recursos",
    "features.tray.title": "Controle pela bandeja",
    "features.tray.desc":
      "Inicie, pare e reinicie seu gateway OpenClaw pela bandeja do sistema. Sem terminal.",
    "features.panel.title": "Painel de gerenciamento local",
    "features.panel.desc":
      "Um painel baseado em navegador rodando em localhost para configurar regras, canais e permissões.",
    "features.rules.title": "Regras e guardas",
    "features.rules.desc":
      "Defina políticas e guardas que entram em vigor imediatamente &mdash; sem reiniciar o gateway.",
    "features.secrets.title": "Segredos seguros",
    "features.secrets.desc":
      "Chaves de API armazenadas no Keychain do macOS ou Windows DPAPI. Nunca escritas em texto simples nos arquivos de configuração.",
    "features.skill.title": "Controle visual de permissões",
    "features.skill.desc":
      "Defina regras de acesso granulares para pastas e arquivos sem editar arquivos de configuração complexos.",
    "features.update.title": "Atualizações automáticas",
    "features.update.desc":
      "Verificador de atualizações integrado notifica quando uma nova versão está disponível. Download com um clique.",
    "download.title": "Baixar EasyClaw",
    "download.version": "Versão",
    "download.mac.btn": "Baixar .dmg",
    "download.win.btn": "Baixar .exe",
    "download.note":
      'Verifique seu download comparando o hash SHA-256 acima com a saída de <code>shasum -a 256</code> (macOS/Linux) ou <code>Get-FileHash</code> (PowerShell).',
    "requirements.title": "Requisitos do sistema",
    "requirements.mac.os": "macOS 12 (Monterey) ou posterior",
    "requirements.mac.arch": "Apple Silicon (M1+) ou Intel",
    "requirements.mac.disk": "200 MB de espaço em disco",
    "requirements.win.os": "Windows 10 (versão 1903+) ou posterior",
    "requirements.win.arch": "Arquitetura x64",
    "requirements.win.disk": "200 MB de espaço em disco",
    "footer.text": "&copy; 2026 EasyClaw. Código aberto em",
  },
  ru: {
    "nav.features": "Возможности",
    "nav.download": "Скачать",
    "nav.requirements": "Требования",
    "hero.title": "Менеджер рабочего стола<br>для OpenClaw",
    "hero.subtitle":
      "EasyClaw предоставляет локальное приложение в трее для управления шлюзом OpenClaw, настройки правил и разрешений &mdash; без использования командной строки.",
    "hero.download": "Скачать сейчас",
    "hero.github": "Смотреть на GitHub",
    "features.title": "Возможности",
    "features.tray.title": "Управление из трея",
    "features.tray.desc":
      "Запускайте, останавливайте и перезапускайте шлюз OpenClaw из системного трея. Терминал не нужен.",
    "features.panel.title": "Локальная панель управления",
    "features.panel.desc":
      "Панель на базе браузера на localhost для настройки правил, каналов и разрешений.",
    "features.rules.title": "Правила и защитники",
    "features.rules.desc":
      "Определяйте политики и защитников, которые вступают в силу мгновенно &mdash; без перезапуска шлюза.",
    "features.secrets.title": "Безопасные секреты",
    "features.secrets.desc":
      "API-ключи хранятся в Keychain macOS или Windows DPAPI. Никогда не записываются в открытом виде в файлы конфигурации.",
    "features.skill.title": "Визуальный контроль прав доступа",
    "features.skill.desc":
      "Задавайте детальные правила доступа к папкам и файлам без редактирования сложных конфигурационных файлов.",
    "features.update.title": "Автоматические обновления",
    "features.update.desc":
      "Встроенная проверка обновлений уведомляет о новых версиях. Загрузка в один клик.",
    "download.title": "Скачать EasyClaw",
    "download.version": "Версия",
    "download.mac.btn": "Скачать .dmg",
    "download.win.btn": "Скачать .exe",
    "download.note":
      'Проверьте загрузку, сравнив хеш SHA-256 выше с выводом <code>shasum -a 256</code> (macOS/Linux) или <code>Get-FileHash</code> (PowerShell).',
    "requirements.title": "Системные требования",
    "requirements.mac.os": "macOS 12 (Monterey) или новее",
    "requirements.mac.arch": "Apple Silicon (M1+) или Intel",
    "requirements.mac.disk": "200 МБ дискового пространства",
    "requirements.win.os": "Windows 10 (версия 1903+) или новее",
    "requirements.win.arch": "Архитектура x64",
    "requirements.win.disk": "200 МБ дискового пространства",
    "footer.text": "&copy; 2026 EasyClaw. Открытый исходный код на",
  },
  ar: {
    "nav.features": "المميزات",
    "nav.download": "تحميل",
    "nav.requirements": "المتطلبات",
    "hero.title": "مدير سطح المكتب<br>لـ OpenClaw",
    "hero.subtitle":
      "يوفر لك EasyClaw تطبيق شريط المهام المحلي لإدارة بوابة OpenClaw وتكوين القواعد والأذونات والحفاظ على تشغيل كل شيء بسلاسة &mdash; دون استخدام سطر الأوامر.",
    "hero.download": "تحميل الآن",
    "hero.github": "عرض على GitHub",
    "features.title": "المميزات",
    "features.tray.title": "التحكم من شريط المهام",
    "features.tray.desc":
      "ابدأ وأوقف وأعد تشغيل بوابة OpenClaw من شريط المهام. لا حاجة للطرفية.",
    "features.panel.title": "لوحة الإدارة المحلية",
    "features.panel.desc":
      "لوحة تعتمد على المتصفح تعمل على localhost لتكوين القواعد والقنوات والأذونات.",
    "features.rules.title": "القواعد والحراس",
    "features.rules.desc":
      "حدد السياسات والحراس التي تسري فوراً &mdash; دون إعادة تشغيل البوابة.",
    "features.secrets.title": "أسرار آمنة",
    "features.secrets.desc":
      "مفاتيح API مخزنة في سلسلة مفاتيح macOS أو Windows DPAPI. لا تُكتب أبداً كنص عادي في ملفات التكوين.",
    "features.skill.title": "التحكم المرئي في الأذونات",
    "features.skill.desc":
      "قم بتعيين قواعد وصول دقيقة للمجلدات والملفات دون تحرير ملفات تكوين معقدة.",
    "features.update.title": "تحديثات تلقائية",
    "features.update.desc":
      "مدقق تحديثات مدمج يُعلمك عند توفر إصدار جديد. تحميل بنقرة واحدة.",
    "download.title": "تحميل EasyClaw",
    "download.version": "الإصدار",
    "download.mac.btn": "تحميل .dmg",
    "download.win.btn": "تحميل .exe",
    "download.note":
      'تحقق من التحميل بمقارنة تجزئة SHA-256 أعلاه مع مخرجات <code>shasum -a 256</code> (macOS/Linux) أو <code>Get-FileHash</code> (PowerShell).',
    "requirements.title": "متطلبات النظام",
    "requirements.mac.os": "macOS 12 (Monterey) أو أحدث",
    "requirements.mac.arch": "Apple Silicon (M1+) أو Intel",
    "requirements.mac.disk": "مساحة قرص 200 ميجابايت",
    "requirements.win.os": "Windows 10 (الإصدار 1903+) أو أحدث",
    "requirements.win.arch": "معمارية x64",
    "requirements.win.disk": "مساحة قرص 200 ميجابايت",
    "footer.text": "&copy; 2026 EasyClaw. مفتوح المصدر على",
  },
  it: {
    "nav.features": "Funzionalità",
    "nav.download": "Scarica",
    "nav.requirements": "Requisiti",
    "hero.title": "Gestore desktop<br>per OpenClaw",
    "hero.subtitle":
      "EasyClaw ti offre un'app nella barra di sistema per gestire il tuo gateway OpenClaw, configurare regole e permessi, e mantenere tutto in funzione &mdash; senza toccare la riga di comando.",
    "hero.download": "Scarica ora",
    "hero.github": "Vedi su GitHub",
    "features.title": "Funzionalità",
    "features.tray.title": "Controllo dalla barra di sistema",
    "features.tray.desc":
      "Avvia, arresta e riavvia il tuo gateway OpenClaw dalla barra di sistema. Nessun terminale richiesto.",
    "features.panel.title": "Pannello di gestione locale",
    "features.panel.desc":
      "Un pannello basato su browser in esecuzione su localhost per configurare regole, canali e permessi.",
    "features.rules.title": "Regole e guardie",
    "features.rules.desc":
      "Definisci policy e guardie che entrano in vigore immediatamente &mdash; senza riavviare il gateway.",
    "features.secrets.title": "Segreti sicuri",
    "features.secrets.desc":
      "Le chiavi API sono archiviate nel Portachiavi macOS o Windows DPAPI. Mai scritte in chiaro nei file di configurazione.",
    "features.skill.title": "Controllo visivo dei permessi",
    "features.skill.desc":
      "Imposta regole di accesso granulari per cartelle e file senza modificare file di configurazione complessi.",
    "features.update.title": "Aggiornamenti automatici",
    "features.update.desc":
      "Controllo aggiornamenti integrato che ti avvisa quando è disponibile una nuova versione. Download con un clic.",
    "download.title": "Scarica EasyClaw",
    "download.version": "Versione",
    "download.mac.btn": "Scarica .dmg",
    "download.win.btn": "Scarica .exe",
    "download.note":
      "Verifica il download confrontando l'hash SHA-256 sopra con l'output di <code>shasum -a 256</code> (macOS/Linux) o <code>Get-FileHash</code> (PowerShell).",
    "requirements.title": "Requisiti di sistema",
    "requirements.mac.os": "macOS 12 (Monterey) o successivo",
    "requirements.mac.arch": "Apple Silicon (M1+) o Intel",
    "requirements.mac.disk": "200 MB di spazio su disco",
    "requirements.win.os": "Windows 10 (versione 1903+) o successivo",
    "requirements.win.arch": "Architettura x64",
    "requirements.win.disk": "200 MB di spazio su disco",
    "footer.text": "&copy; 2026 EasyClaw. Open source su",
  },
  tr: {
    "nav.features": "Özellikler",
    "nav.download": "İndir",
    "nav.requirements": "Gereksinimler",
    "hero.title": "OpenClaw için<br>Masaüstü Çalışma Zamanı Yöneticisi",
    "hero.subtitle":
      "EasyClaw, OpenClaw ağ geçidinizi yönetmek, kuralları ve izinleri yapılandırmak ve her şeyin sorunsuz çalışmasını sağlamak için yerel bir sistem tepsisi uygulaması sunar &mdash; komut satırına dokunmadan.",
    "hero.download": "Şimdi indir",
    "hero.github": "GitHub'da görüntüle",
    "features.title": "Özellikler",
    "features.tray.title": "Tepsi uygulaması kontrolü",
    "features.tray.desc":
      "OpenClaw ağ geçidinizi sistem tepsisinden başlatın, durdurun ve yeniden başlatın. Terminal gerekmez.",
    "features.panel.title": "Yerel yönetim paneli",
    "features.panel.desc":
      "Kuralları, kanalları ve izinleri yapılandırmak için localhost üzerinde çalışan tarayıcı tabanlı panel.",
    "features.rules.title": "Kurallar ve korumalar",
    "features.rules.desc":
      "Anında yürürlüğe giren politikalar ve korumalar tanımlayın &mdash; ağ geçidi yeniden başlatması gerekmez.",
    "features.secrets.title": "Güvenli sırlar",
    "features.secrets.desc":
      "API anahtarları macOS Anahtar Zinciri veya Windows DPAPI'de saklanır. Yapılandırma dosyalarına asla düz metin olarak yazılmaz.",
    "features.skill.title": "Görsel izin kontrolü",
    "features.skill.desc":
      "Karmaşık yapılandırma dosyalarını düzenlemeden klasörler ve dosyalar için ayrıntılı erişim kuralları belirleyin.",
    "features.update.title": "Otomatik güncellemeler",
    "features.update.desc":
      "Yerleşik güncelleme denetleyicisi yeni sürüm mevcut olduğunda bildirir. Tek tıkla indirme.",
    "download.title": "EasyClaw'ı İndir",
    "download.version": "Sürüm",
    "download.mac.btn": ".dmg İndir",
    "download.win.btn": ".exe İndir",
    "download.note":
      'İndirmenizi, yukarıdaki SHA-256 karmasını <code>shasum -a 256</code> (macOS/Linux) veya <code>Get-FileHash</code> (PowerShell) çıktısıyla karşılaştırarak doğrulayın.',
    "requirements.title": "Sistem gereksinimleri",
    "requirements.mac.os": "macOS 12 (Monterey) veya üzeri",
    "requirements.mac.arch": "Apple Silicon (M1+) veya Intel",
    "requirements.mac.disk": "200 MB disk alanı",
    "requirements.win.os": "Windows 10 (sürüm 1903+) veya üzeri",
    "requirements.win.arch": "x64 mimarisi",
    "requirements.win.disk": "200 MB disk alanı",
    "footer.text": "&copy; 2026 EasyClaw. Açık kaynak:",
  },
};

const LANG_LABELS = {
  en: "EN",
  zh: "中文",
  ja: "日本語",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  th: "ไทย",
  ko: "한국어",
  pt: "Português",
  ru: "Русский",
  ar: "العربية",
  it: "Italiano",
  tr: "Türkçe",
};
const SUPPORTED = Object.keys(translations);
const STORAGE_KEY = "easyclaw-lang";

function detectLang() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && SUPPORTED.includes(saved)) return saved;
  const nav = (navigator.language || "").toLowerCase();
  if (nav.startsWith("zh")) return "zh";
  if (nav.startsWith("ja")) return "ja";
  if (nav.startsWith("fr")) return "fr";
  if (nav.startsWith("de")) return "de";
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("th")) return "th";
  if (nav.startsWith("ko")) return "ko";
  if (nav.startsWith("pt")) return "pt";
  if (nav.startsWith("ru")) return "ru";
  if (nav.startsWith("ar")) return "ar";
  if (nav.startsWith("it")) return "it";
  if (nav.startsWith("tr")) return "tr";
  return "en";
}

function applyLang(lang) {
  const dict = translations[lang] || translations.en;
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (dict[key] != null) el.innerHTML = dict[key];
  });
  localStorage.setItem(STORAGE_KEY, lang);
  // Update dropdown display and active option
  const current = document.querySelector(".lang-current");
  if (current) current.textContent = LANG_LABELS[lang] || lang;
  document.querySelectorAll(".lang-option").forEach((opt) => {
    opt.classList.toggle("active", opt.dataset.lang === lang);
  });
}

function initI18n() {
  const lang = detectLang();
  applyLang(lang);

  const switcher = document.querySelector(".lang-switcher");
  const toggle = document.getElementById("lang-toggle");

  // Toggle dropdown open/close
  toggle.addEventListener("click", (e) => {
    e.stopPropagation();
    switcher.classList.toggle("open");
    toggle.setAttribute("aria-expanded", switcher.classList.contains("open"));
  });

  // Handle option selection
  document.querySelectorAll(".lang-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      applyLang(opt.dataset.lang);
      switcher.classList.remove("open");
      toggle.setAttribute("aria-expanded", "false");
    });
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", () => {
    switcher.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  });
}

document.addEventListener("DOMContentLoaded", initI18n);
