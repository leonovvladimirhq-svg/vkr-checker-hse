// ============================================================
// Склонение русского ФИО в родительный падеж
//
// Нужно ровно для одной строки шаблона отзыва руководителя
// (приложение 36 Программы практики ОП РиСО):
//     «Студента(ки) ______________ (фамилия, имя, отчество)»
// — конструкция требует родительного падежа: «Студентки Ивановой Марии Сергеевны».
//
// ВАЖНО про точность. Склонение — единственное поле отзыва, которое не является
// прямым переносом или подсчётом: правила русского языка знают исключения
// (несклоняемые фамилии, омонимия, иностранные основы). Поэтому:
//   * реализованы только надёжные, однозначные правила;
//   * в сомнительных случаях слово возвращается без изменений (лучше именительный
//     падеж, чем выдуманная форма);
//   * в самом отзыве под ФИО печатается исходное написание, чтобы руководителю
//     было что сверить одним взглядом.
// ============================================================

export type Gender = 'male' | 'female' | 'unknown';

/** Шипящие и заднеязычные: после них в родительном падеже пишется «и», а не «ы». */
const HUSH_OR_VELAR = /[гкхжчшщ]$/i;

/** Фамилии, которые не склоняются вовсе. */
function isIndeclinableSurname(s: string): boolean {
  // На -о (Шевченко), -их/-ых (Черных), -ко, а также на гласные -е, -и, -у, -ю, -э
  return /(?:[оеиуюэ]|ых|их)$/i.test(s);
}

/**
 * Определяет пол по отчеству — это единственный по-настоящему надёжный признак.
 * По имени и фамилии не гадаем: «Саша», «Женя», «Коваль» неоднозначны.
 */
export function detectGender(patronymic?: string): Gender {
  if (!patronymic) return 'unknown';
  const p = patronymic.trim();
  if (/(?:ович|евич|ьевич|ич)$/i.test(p)) return 'male';
  if (/(?:овна|евна|ьевна|ична|инична)$/i.test(p)) return 'female';
  return 'unknown';
}

function genitiveSurname(s: string, gender: Gender): string {
  if (!s || isIndeclinableSurname(s)) return s;

  if (gender === 'female') {
    // Ивановой, Синицыной, Достоевской
    if (/(?:ова|ева|ёва|ина|ына)$/i.test(s)) return s.slice(0, -1) + 'ой';
    if (/(?:ская|цкая|ая|яя)$/i.test(s)) return s.slice(0, -2) + 'ой';
    // Женская фамилия на согласный (Коваль, Шмидт) не склоняется
    if (/[бвгджзйклмнпрстфхцчшщь]$/i.test(s)) return s;
    return s;
  }

  if (gender === 'male') {
    // Иванов → Иванова, Синицын → Синицына
    if (/(?:ов|ев|ёв|ин|ын)$/i.test(s)) return s + 'а';
    // Достоевский → Достоевского, Толстой → Толстого
    if (/(?:ский|цкий|ый|ий)$/i.test(s)) return s.slice(0, -2) + 'ого';
    if (/ой$/i.test(s)) return s.slice(0, -2) + 'ого';
    // Гай → Гая, Соловей → Соловья не угадаем — берём безопасный вариант
    if (/й$/i.test(s)) return s.slice(0, -1) + 'я';
    if (/ь$/i.test(s)) return s.slice(0, -1) + 'я';
    if (/я$/i.test(s)) return s.slice(0, -1) + 'и';
    if (/а$/i.test(s)) return s.slice(0, -1) + (HUSH_OR_VELAR.test(s.slice(0, -1)) ? 'и' : 'ы');
    // Кузнец → Кузнеца, Шмидт → Шмидта
    if (/[бвгдзклмнпрстфхцчшщ]$/i.test(s)) return s + 'а';
    return s;
  }

  // Пол не определён — не рискуем
  return s;
}

/**
 * Имена с беглой гласной и чередованием ё/е — общее правило их ломает
 * («Пётр» → «Пётра» вместо «Петра»). Список закрытый и короткий: сюда
 * попадают только имена, где ошибка возникает системно.
 */
const FIRST_NAME_EXCEPTIONS: Record<string, string> = {
  'пётр': 'Петра',
  'петр': 'Петра',
  'павел': 'Павла',
  'лев': 'Льва',
  'пaвел': 'Павла',
};

function applyCase(sample: string, replacement: string): string {
  // Сохраняем регистр первой буквы исходного написания
  return sample[0] === sample[0].toLowerCase()
    ? replacement.toLowerCase()
    : replacement;
}

function genitiveFirstName(s: string, gender: Gender): string {
  if (!s) return s;

  // Только при точно определённом мужском поле: иначе склонённое имя рядом
  // с несклонённой фамилией смотрится хуже, чем полностью именительный падеж.
  const ex = FIRST_NAME_EXCEPTIONS[s.toLowerCase()];
  if (ex && gender === 'male') return applyCase(s, ex);

  if (gender === 'female') {
    if (/ия$/i.test(s)) return s.slice(0, -1) + 'и';       // Мария → Марии
    if (/я$/i.test(s)) return s.slice(0, -1) + 'и';        // Ксения → Ксении, Дарья → Дарьи
    if (/а$/i.test(s)) {                                    // Анна → Анны, Ольга → Ольги
      return s.slice(0, -1) + (HUSH_OR_VELAR.test(s.slice(0, -1)) ? 'и' : 'ы');
    }
    if (/ь$/i.test(s)) return s.slice(0, -1) + 'и';        // Любовь → Любови
    return s;
  }

  if (gender === 'male') {
    if (/(?:ий|ей|ай|ой|уй)$/i.test(s)) return s.slice(0, -1) + 'я'; // Андрей → Андрея
    if (/й$/i.test(s)) return s.slice(0, -1) + 'я';
    if (/ь$/i.test(s)) return s.slice(0, -1) + 'я';                  // Игорь → Игоря
    if (/а$/i.test(s)) {                                              // Никита → Никиты
      return s.slice(0, -1) + (HUSH_OR_VELAR.test(s.slice(0, -1)) ? 'и' : 'ы');
    }
    if (/я$/i.test(s)) return s.slice(0, -1) + 'и';                  // Илья → Ильи
    if (/[бвгдзклмнпрстфхцчшщ]$/i.test(s)) return s + 'а';           // Иван → Ивана
    return s;
  }

  return s;
}

function genitivePatronymic(s: string, gender: Gender): string {
  if (!s) return s;
  if (gender === 'male' && /ич$/i.test(s)) return s + 'а';           // Сергеевич → Сергеевича
  if (gender === 'female' && /(?:вна|чна)$/i.test(s)) return s.slice(0, -1) + 'ы'; // Сергеевна → Сергеевны
  return s;
}

export interface DeclinedName {
  /** ФИО в родительном падеже (или исходное, если склонить надёжно нельзя). */
  genitive: string;
  /** Исходное написание — печатается рядом для сверки. */
  nominative: string;
  gender: Gender;
  /** «Студента» / «Студентки» / «Студента(ки)» — по шаблону приложения 36. */
  studentWord: string;
  /** true, если хоть одно слово удалось просклонять. */
  changed: boolean;
}

/**
 * Раскладывает «Фамилия Имя Отчество» и ставит в родительный падеж.
 * Порядок слов — как в форме студента (валидация требует минимум 2 слова).
 */
export function toGenitiveFullName(fullName: string): DeclinedName {
  const nominative = (fullName || '').trim().replace(/\s+/g, ' ');
  const parts = nominative.split(' ').filter(Boolean);

  if (parts.length === 0) {
    return { genitive: '', nominative: '', gender: 'unknown', studentWord: 'Студента(ки)', changed: false };
  }

  const [surname, firstName, patronymic] = [parts[0], parts[1] || '', parts.slice(2).join(' ')];
  const gender = detectGender(patronymic);

  const out = [
    genitiveSurname(surname, gender),
    genitiveFirstName(firstName, gender),
    genitivePatronymic(patronymic, gender),
  ].filter(Boolean).join(' ');

  const studentWord =
    gender === 'male' ? 'Студента' : gender === 'female' ? 'Студентки' : 'Студента(ки)';

  return {
    genitive: out || nominative,
    nominative,
    gender,
    studentWord,
    changed: out !== nominative,
  };
}
