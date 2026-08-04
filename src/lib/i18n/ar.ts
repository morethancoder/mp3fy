import type { Messages } from './en';

export const ar: Messages = {
	appName: 'mp3fy',

	nav: {
		home: 'الرئيسية',
		convert: 'تحويل',
		library: 'المكتبة',
		settings: 'الإعدادات'
	},

	home: {
		title: 'mp3fy',
		subtitle: 'الصق رابط فيديو واحصل على ملف صوتي، يُحوَّل على جهازك.',
		videoLink: 'رابط الفيديو',
		linkPlaceholder: 'https://…',
		paste: 'لصق',
		pasteFailed: 'الحافظة فارغة أو تعذّرت قراءتها',
		notALink: 'الحافظة لا تحتوي على رابط',
		clear: 'مسح',
		sharedStarted: 'وصل الرابط — يبدأ التنزيل الآن',
		sharedQueued: 'أُضيف الرابط إلى الانتظار — يبدأ بعد انتهاء التنزيل الحالي',
		queuedCount: (n: number) => (n === 1 ? 'رابط واحد في الانتظار' : `${n} روابط في الانتظار`),
		options: 'خيارات',
		format: 'الصيغة',
		formatBest: 'الأفضل (الأصلية)',
		quality: 'الجودة',
		qualityHelp: 'تُطبَّق عند التحويل فقط — خيار «الأفضل (الأصلية)» لا يعيد الترميز إطلاقاً.',
		audioFormats: 'صوت',
		videoFormats: 'فيديو',
		duplicateTitle: 'لديك هذا الملف بالفعل',
		duplicateBody: (title: string) => `«${title}» جاء من هذا الرابط.`,
		duplicateAgain: 'تنزيله مجدداً',
		duplicateKeep: 'الاحتفاظ بالملف الحالي',
		getAudio: 'تنزيل الصوت',
		getVideo: 'تنزيل الفيديو',
		cancel: 'إلغاء',
		failed: 'فشل التنزيل',
		savedTo: (folder: string) => `حُفظ في ${folder}`,
		saved: 'تم الحفظ'
	},

	steps: {
		preparing: 'جارٍ التجهيز — التحقق من yt-dlp و ffmpeg…',
		fetching: 'جارٍ جلب معلومات الفيديو…',
		downloading: 'جارٍ التنزيل',
		converting: (format: string) => `جارٍ التحويل إلى ${format} — أوشكنا على الانتهاء…`,
		finishing: 'جارٍ حفظ الصوت — أوشكنا على الانتهاء…',
		eta: (eta: string) => `متبقٍ ${eta}`,
		of: (size: string) => `من ${size}`
	},

	done: {
		play: 'تشغيل',
		openInFiles: 'فتح في الملفات',
		openWith: 'فتح بواسطة…',
		share: 'مشاركة',
		more: 'إجراءات أخرى',
		dismiss: 'إخفاء',
		shareFallback: 'المشاركة غير متاحة هنا — سنعرض الملف بدلاً من ذلك'
	},

	quality: {
		best: 'أفضل جودة متاحة',
		high: 'عالية (320 كيلوبت/ث)',
		standard: 'قياسية (192 كيلوبت/ث)',
		small: 'صغيرة (128 كيلوبت/ث)'
	},

	library: {
		title: 'المكتبة',
		emptyTitle: 'لا شيء هنا بعد',
		emptyBody: 'الملفات التي تنزّلها أو تحوّلها تظهر هنا جاهزة للتشغيل.',
		all: 'الكل',
		sortRecent: 'الأحدث',
		sortPlays: 'الأكثر تشغيلاً',
		sortTitle: 'العنوان',
		playsCount: (n: number) => `${n} تشغيل`,
		actions: 'إجراءات',
		play: 'تشغيل',
		reveal: 'فتح في الملفات',
		share: 'مشاركة',
		remove: 'إزالة',
		removed: 'أُزيل',
		missing: 'الملف لم يعد موجوداً على القرص',
		openFailed: 'لا يوجد تطبيق على هذا الجهاز يستطيع فتح هذا الملف',
		addToPlaylist: 'إضافة إلى قائمة تشغيل',
		playlistName: 'اسم قائمة التشغيل',
		create: 'إنشاء',
		done: 'تم',
		deletePlaylist: 'حذف قائمة التشغيل'
	},

	player: {
		seek: 'التنقّل في المقطع',
		play: 'تشغيل',
		pause: 'إيقاف مؤقت',
		back10: 'رجوع 10 ثوانٍ',
		forward10: 'تقديم 10 ثوانٍ',
		previous: 'المقطع السابق',
		next: 'المقطع التالي',
		close: 'تصغير المشغّل',
		stop: 'إغلاق المشغّل',
		nowPlaying: 'قيد التشغيل الآن',
		options: 'خيارات التشغيل',
		shuffle: 'تشغيل عشوائي',
		repeat: 'التكرار',
		repeatOff: 'إيقاف',
		repeatAll: 'تكرار الكل',
		repeatOne: 'تكرار المقطع',
		volume: 'مستوى الصوت',
		swipeHint: 'اسحب يميناً أو يساراً لتغيير المقطع، وللأسفل لتصغير المشغّل',
		failed: 'تعذّر تشغيل هذا الملف'
	},

	convert: {
		title: 'حوّل ملفاً محلياً',
		subtitle: 'حوّل أي ملف فيديو أو صوت على هذا الجهاز إلى الصيغة التي تريدها.',
		chooseFile: 'اختيار ملف',
		changeFile: 'تغيير الملف',
		targetFormat: 'الصيغة الهدف',
		convert: 'تحويل',
		converting: 'جارٍ التحويل…',
		preparing: 'جارٍ التجهيز…',
		failed: 'فشل التحويل',
		pickerTitle: 'اختر ملف فيديو أو صوت',
		notOnAndroid: 'غير متاح على أندرويد بعد',
		notOnAndroidBody:
			'تحويل ملف موجود على جهازك متاح على سطح المكتب فقط حالياً. أما التنزيل من رابط — والتحويل أثناءه — فيعمل هنا.'
	},

	settings: {
		title: 'الإعدادات',
		appearance: 'المظهر',
		light: 'فاتح',
		dark: 'داكن',
		system: 'النظام',
		appearanceHelp: 'خيار «النظام» يتبع الجهاز، ويستمر في متابعته إذا تغيّر وضع الجهاز أثناء فتح التطبيق.',
		language: 'لغة التطبيق',
		english: 'English',
		arabic: 'العربية',
		languageSystem: 'النظام',
		languageHelp: 'خيار «النظام» يتبع لغة الجهاز، ويعرض العربية عندما يكون الجهاز بالعربية.',
		downloads: 'التنزيلات',
		defaultFormat: 'الصيغة الافتراضية',
		defaultQuality: 'الجودة الافتراضية',
		openFolder: 'فتح مجلد التنزيلات',
		ytdlp: 'yt-dlp',
		notInstalled: 'غير مثبّتة بعد',
		checkForUpdates: 'التحقق من التحديثات',
		upToDate: (version: string) => `yt-dlp محدّثة (${version})`,
		updated: (version: string) => `تم تحديث yt-dlp إلى ${version}`,
		autoUpdate: 'تحديث تلقائي',
		autoUpdateHelp: 'إبقاء yt-dlp محدّثة عند كل تشغيل',
		ffmpegMissingTitle: 'لم يُعثر على ffmpeg',
		ffmpegMissingBody: 'التحويل يحتاج ffmpeg — سيُجلب تلقائياً عند أول تنزيل.',
		tools: 'الأدوات',
		toolsHelp:
			'البرنامجان اللذان ينجزان العمل. التنزيل الذي يفشل بلا سبب ظاهر يكون غالباً بسبب قِدَم yt-dlp — المواقع تتغيّر، والنسخة القديمة تُرفض.',
		toolReady: 'جاهزة',
		toolMissing: 'مفقودة',
		toolChecking: 'جارٍ الفحص…',
		toolSource: {
			bundled: 'مرفقة مع التطبيق',
			updated: 'مُحدّثة على هذا الجهاز',
			managed: 'نزّلها التطبيق',
			system: 'موجودة في النظام',
			missing: 'غير مثبّتة'
		},
		toolRecheck: 'إعادة الفحص',
		about: 'حول التطبيق',
		aboutBody:
			'يحوّل أي رابط فيديو إلى ملف صوتي، بالكامل على جهازك. تنزيلاتك تستخدم اتصالك الخاص — لا شيء يمر عبر خادم.',
		aboutStack: 'يعمل بواسطة yt-dlp و ffmpeg. بُني بـ SvelteKit و Tauri و MoreThanUI.',
		developer: 'المطوّر',
		logs: 'السجلات',
		logsHelp: 'ما فعله التطبيق وأدواته، الأحدث أولاً.'
	},

	logs: {
		title: 'السجلات',
		empty: 'لا سجلات بعد',
		refresh: 'تحديث',
		back: 'رجوع'
	}
};
