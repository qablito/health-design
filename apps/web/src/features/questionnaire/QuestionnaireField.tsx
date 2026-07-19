import { useId, useState } from "react";

type Option = { label: string; value: string };
export type QuestionnaireQuestion = {
  blockId: string;
  id: string;
  kind:
    "boolean" | "date" | "entities" | "multi" | "number" | "single" | "text" | "time";
  label: string;
  options?: readonly Option[];
};

const FALLBACK_OPTIONS: Readonly<Record<string, readonly Option[]>> = {
  hydrationClimate: [
    { label: "Templado", value: "temperate" },
    { label: "Caluroso", value: "hot" },
    { label: "Frío", value: "cold" },
    { label: "Variable", value: "variable" },
  ],
  hydrationSweat: [
    { label: "Baja", value: "low" },
    { label: "Media", value: "medium" },
    { label: "Alta", value: "high" },
    { label: "No lo sé", value: "unknown" },
  ],
  menopauseStage: [
    { label: "No aplica", value: "not_applicable" },
    { label: "Premenopausia", value: "pre" },
    { label: "Perimenopausia", value: "peri" },
    { label: "Posmenopausia", value: "post" },
    { label: "No lo sé", value: "unknown" },
  ],
  mobilityDiscomfortStatus: statusOptions(),
  mobilityMinutes: [5, 10, 15].map((value) => ({
    label: `${value} minutos`,
    value: String(value),
  })),
  nutritionAllergiesStatus: statusOptions(),
  nutritionFoodAnxiety: [
    { label: "No", value: "no" },
    { label: "A veces", value: "sometimes" },
    { label: "Frecuente", value: "frequent" },
    { label: "Prefiero no indicarlo", value: "prefer_not_to_say" },
  ],
  nutritionIntolerancesStatus: statusOptions(),
  ownTrainingIntensity: [
    { label: "Baja", value: "low" },
    { label: "Moderada", value: "moderate" },
    { label: "Alta", value: "high" },
    { label: "Variable", value: "variable" },
  ],
  pregnancyLactation: [
    { label: "No aplica", value: "not_applicable" },
    { label: "Ninguna", value: "none" },
    { label: "Embarazo", value: "pregnant" },
    { label: "Lactancia", value: "lactating" },
    { label: "Buscando embarazo", value: "trying_to_conceive" },
    { label: "No lo sé", value: "unknown" },
  ],
  proteinPreference: [
    { label: "Solo alimentos", value: "food_only" },
    { label: "Uso habitual de proteína en polvo", value: "usual_powder" },
    { label: "Solo como sustitución opcional", value: "optional_substitution" },
  ],
  sleepQuality: [
    { label: "Muy mala", value: "very_poor" },
    { label: "Mala", value: "poor" },
    { label: "Aceptable", value: "fair" },
    { label: "Buena", value: "good" },
    { label: "Muy buena", value: "very_good" },
  ],
  sleepRegularity: [
    { label: "Regular", value: "regular" },
    { label: "Algo variable", value: "somewhat_variable" },
    { label: "Muy variable", value: "very_variable" },
  ],
  supplementRecommendationPreference: [
    { label: "Solo cubrir carencias", value: "only_deficiencies" },
    { label: "También opciones contextuales", value: "contextual" },
    { label: "No quiero recomendaciones", value: "none" },
  ],
  trainingLimitationsStatus: statusOptions(),
};

const MULTI_OPTIONS: Readonly<Record<string, readonly Option[]>> = {
  generatedTrainingEquipment: [
    { label: "Sin material", value: "none" },
    { label: "Bandas o mancuernas", value: "home_basic" },
    { label: "Gimnasio completo", value: "full_gym" },
  ],
  generatedTrainingStyles: trainingOptions(),
  habitualBeverages: [
    { label: "Agua", value: "water" },
    { label: "Café", value: "coffee" },
    { label: "Té", value: "tea" },
    { label: "Leche", value: "milk" },
    { label: "Refrescos", value: "soft_drinks" },
    { label: "Alcohol", value: "alcohol" },
  ],
  hydrationAnchors: [
    { label: "Al despertar", value: "wake" },
    { label: "Con las comidas", value: "meals" },
    { label: "Antes de entrenar", value: "pre_training" },
    { label: "Durante el trabajo", value: "work" },
  ],
  mobilityAreas: [
    { label: "Cuello", value: "neck" },
    { label: "Hombros", value: "shoulders" },
    { label: "Columna", value: "spine" },
    { label: "Caderas", value: "hips" },
    { label: "Rodillas", value: "knees" },
    { label: "Tobillos", value: "ankles" },
  ],
  ownTrainingTypes: trainingOptions(),
  supplementGoals: [
    { label: "Cubrir carencias", value: "deficiencies" },
    { label: "Descanso", value: "sleep" },
    { label: "Rendimiento", value: "performance" },
    { label: "Bienestar", value: "wellbeing" },
  ],
};

function statusOptions(): Option[] {
  return [
    { label: "No", value: "none" },
    { label: "Sí", value: "declared" },
    { label: "No lo sé", value: "unknown" },
  ];
}

function trainingOptions(): Option[] {
  return [
    { label: "Hipertrofia", value: "hypertrophy" },
    { label: "Fuerza", value: "strength" },
    { label: "Calistenia / peso corporal", value: "bodyweight" },
    { label: "Pilates", value: "pilates" },
    { label: "Yoga", value: "yoga" },
    { label: "Resistencia", value: "endurance" },
  ];
}

function scalarValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

export function QuestionnaireField({
  onChange,
  question,
  value,
}: {
  onChange: (value: unknown) => void;
  question: QuestionnaireQuestion;
  value: unknown;
}) {
  const options = question.options ?? FALLBACK_OPTIONS[question.id] ?? [];
  if (question.kind === "boolean") {
    return (
      <label className="question-field">
        <span>{question.label}</span>
        <select
          aria-label={question.label}
          onChange={(event) =>
            onChange(
              event.target.value === "" ? undefined : event.target.value === "true",
            )
          }
          value={scalarValue(value)}
        >
          <option value="">Selecciona una opción</option>
          <option value="false">No</option>
          <option value="true">Sí</option>
        </select>
      </label>
    );
  }
  if (question.kind === "single") {
    return (
      <label className="question-field">
        <span>{question.label}</span>
        <select
          aria-label={question.label}
          onChange={(event) => {
            const next = event.target.value;
            onChange(
              next === ""
                ? undefined
                : question.id === "mobilityMinutes"
                  ? Number(next)
                  : next,
            );
          }}
          value={scalarValue(value)}
        >
          <option value="">Selecciona una opción</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (question.kind === "multi") {
    const selected = new Set(Array.isArray(value) ? value.map(String) : []);
    const multiOptions = options.length ? options : (MULTI_OPTIONS[question.id] ?? []);
    return (
      <fieldset className="question-field option-fieldset">
        <legend>{question.label}</legend>
        <div className="chip-grid">
          {multiOptions.map((option) => (
            <label className="choice-chip" key={option.value}>
              <input
                aria-label={option.label}
                checked={selected.has(option.value)}
                onChange={(event) => {
                  const next = new Set(selected);
                  if (event.target.checked) next.add(option.value);
                  else next.delete(option.value);
                  onChange([...next]);
                }}
                type="checkbox"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (question.kind === "text") {
    return (
      <SearchTextField
        label={question.label}
        onChange={onChange}
        options={options}
        value={value}
      />
    );
  }
  if (question.kind === "entities") {
    if (question.id === "medications" || question.id === "currentSupplements") {
      return (
        <MedicationEntries
          label={question.label}
          onChange={onChange}
          suggestions={options}
          value={value}
        />
      );
    }
    if (question.id === "nutritionIntolerances") {
      return (
        <IntoleranceEntries
          label={question.label}
          onChange={onChange}
          suggestions={options}
          value={value}
        />
      );
    }
    if (question.id === "labValues") {
      return (
        <LabEntries
          label={question.label}
          onChange={onChange}
          suggestions={options}
          value={value}
        />
      );
    }
    const structured =
      question.id === "conditions" || question.id === "nutritionAllergies";
    if (structured) {
      return (
        <NamedEntries
          id={question.id}
          label={question.label}
          onChange={onChange}
          suggestions={options}
          value={value}
        />
      );
    }
    return (
      <ListEntries
        id={question.id}
        label={question.label}
        onChange={onChange}
        suggestions={options}
        value={value}
      />
    );
  }
  return (
    <label className="question-field">
      <span>{question.label}</span>
      <input
        aria-label={question.label}
        inputMode={question.kind === "number" ? "decimal" : undefined}
        onChange={(event) =>
          onChange(
            event.target.value === ""
              ? undefined
              : question.kind === "number"
                ? Number(event.target.value)
                : event.target.value,
          )
        }
        step={question.kind === "number" ? "any" : undefined}
        type={question.kind}
        value={scalarValue(value)}
      />
    </label>
  );
}

function SearchTextField({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: unknown) => void;
  options: readonly Option[];
  value: unknown;
}) {
  const inputId = useId();
  const suggestionId = `${inputId}-suggestions`;
  return (
    <label className="question-field" htmlFor={inputId}>
      <span>{label}</span>
      <input
        id={inputId}
        list={options.length ? suggestionId : undefined}
        maxLength={120}
        onChange={(event) =>
          onChange(event.target.value === "" ? undefined : event.target.value)
        }
        type="text"
        value={scalarValue(value)}
      />
      <SuggestionList id={suggestionId} options={options} />
    </label>
  );
}

function ListEntries({
  id,
  label,
  onChange,
  suggestions,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: unknown) => void;
  suggestions: readonly Option[];
  value: unknown;
}) {
  const inputId = useId();
  const suggestionId = `${inputId}-suggestions`;
  const [input, setInput] = useState("");
  const entries = isUnknownArray(value) ? value : [];
  const names = entries.map((entry) => (typeof entry === "string" ? entry : ""));
  const action =
    id === "preferredFoods"
      ? "Añadir alimento preferido"
      : id === "excludedFoods"
        ? "Añadir alimento excluido"
        : `Añadir ${label.toLocaleLowerCase("es")}`;
  return (
    <fieldset className="question-field entity-fieldset">
      <legend>{label}</legend>
      <div className="inline-entry">
        <input
          aria-label={label}
          id={inputId}
          list={suggestions.length ? suggestionId : undefined}
          maxLength={120}
          onChange={(event) => setInput(event.target.value)}
          value={input}
        />
        <button
          aria-label={action}
          className="secondary-button"
          disabled={!input.trim()}
          onClick={() => {
            const next = input.trim();
            if (!next) return;
            onChange([...entries, next]);
            setInput("");
          }}
          type="button"
        >
          Añadir
        </button>
      </div>
      <SuggestionList id={suggestionId} options={suggestions} />
      <p className="field-help">
        Busca una sugerencia o escribe una opción que no aparezca.
      </p>
      {names.length ? (
        <ul className="entry-list">
          {names.map((name, index) => (
            <li key={`${name}-${index}`}>
              <span>{name}</span>
              <button
                aria-label={`Quitar ${name}`}
                className="text-button"
                onClick={() =>
                  onChange(entries.filter((_, itemIndex) => itemIndex !== index))
                }
                type="button"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}

function NamedEntries({
  id,
  label,
  onChange,
  suggestions,
  value,
}: EntryProps & { id: string }) {
  const suggestionId = `${useId()}-suggestions`;
  const [entry, setEntry] = useState({ name: "", note: "" });
  const entries = isUnknownArray(value) ? value : [];
  const noteLabel =
    id === "nutritionAllergies"
      ? "Contaminación cruzada o detalle (opcional)"
      : "Detalle breve (opcional)";
  return (
    <fieldset className="question-field entity-fieldset">
      <legend>{label}</legend>
      <div className="entity-grid">
        <label>
          <span>Nombre</span>
          <input
            list={suggestions.length ? suggestionId : undefined}
            maxLength={120}
            onChange={(event) =>
              setEntry((current) => ({ ...current, name: event.target.value }))
            }
            value={entry.name}
          />
        </label>
        <label>
          <span>{noteLabel}</span>
          <input
            maxLength={500}
            onChange={(event) =>
              setEntry((current) => ({ ...current, note: event.target.value }))
            }
            value={entry.note}
          />
        </label>
      </div>
      <SuggestionList id={suggestionId} options={suggestions} />
      <p className="field-help">
        Busca una sugerencia o escribe una opción que no aparezca.
      </p>
      <button
        className="secondary-button"
        disabled={!entry.name.trim()}
        onClick={() => {
          onChange([
            ...entries,
            {
              name: entry.name.trim(),
              ...(entry.note.trim() ? { note: entry.note.trim() } : {}),
            },
          ]);
          setEntry({ name: "", note: "" });
        }}
        type="button"
      >
        Añadir
      </button>
      <EntrySummary entries={entries} onChange={onChange} />
    </fieldset>
  );
}

function MedicationEntries({ label, onChange, suggestions, value }: EntryProps) {
  const suggestionId = `${useId()}-suggestions`;
  const [entry, setEntry] = useState({
    dose: "",
    frequency: "",
    name: "",
    route: "",
    schedule: "",
  });
  const entries = isUnknownArray(value) ? value : [];
  return (
    <fieldset className="question-field entity-fieldset">
      <legend>{label}</legend>
      <div className="entity-grid">
        {Object.entries({
          name: "Nombre",
          dose: "Dosis (si se conoce)",
          frequency: "Frecuencia",
          route: "Vía",
          schedule: "Horario",
        }).map(([key, fieldLabel]) => (
          <label key={key}>
            <span>{fieldLabel}</span>
            <input
              list={key === "name" && suggestions.length ? suggestionId : undefined}
              maxLength={120}
              onChange={(event) =>
                setEntry((current) => ({ ...current, [key]: event.target.value }))
              }
              value={entry[key as keyof typeof entry]}
            />
          </label>
        ))}
      </div>
      <SuggestionList id={suggestionId} options={suggestions} />
      <p className="field-help">
        Busca por nombre o escribe uno que no aparezca. Los demás datos son opcionales
        cuando no se conocen.
      </p>
      <button
        className="secondary-button"
        disabled={!entry.name.trim()}
        onClick={() => {
          const cleaned = Object.fromEntries(
            Object.entries(entry)
              .filter(([, item]) => item.trim())
              .map(([key, item]) => [key, item.trim()]),
          );
          onChange([...entries, cleaned]);
          setEntry({ dose: "", frequency: "", name: "", route: "", schedule: "" });
        }}
        type="button"
      >
        Añadir
      </button>
      <EntrySummary entries={entries} onChange={onChange} />
    </fieldset>
  );
}

function IntoleranceEntries({ label, onChange, suggestions, value }: EntryProps) {
  const suggestionId = `${useId()}-suggestions`;
  const [name, setName] = useState("");
  const [severity, setSeverity] = useState("mild");
  const [toleratedAmount, setToleratedAmount] = useState("");
  const entries = isUnknownArray(value) ? value : [];
  return (
    <fieldset className="question-field entity-fieldset">
      <legend>{label}</legend>
      <div className="entity-grid">
        <label>
          <span>Alimento</span>
          <input
            list={suggestions.length ? suggestionId : undefined}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            value={name}
          />
        </label>
        <label>
          <span>Cantidad tolerada</span>
          <input
            maxLength={120}
            onChange={(event) => setToleratedAmount(event.target.value)}
            value={toleratedAmount}
          />
        </label>
        <label>
          <span>Gravedad</span>
          <select
            onChange={(event) => setSeverity(event.target.value)}
            value={severity}
          >
            <option value="mild">Leve</option>
            <option value="moderate">Moderada</option>
            <option value="severe">Grave</option>
          </select>
        </label>
      </div>
      <SuggestionList id={suggestionId} options={suggestions} />
      <button
        className="secondary-button"
        disabled={!name.trim()}
        onClick={() => {
          onChange([
            ...entries,
            {
              name: name.trim(),
              severity,
              ...(toleratedAmount.trim()
                ? { toleratedAmount: toleratedAmount.trim() }
                : {}),
            },
          ]);
          setName("");
          setToleratedAmount("");
          setSeverity("mild");
        }}
        type="button"
      >
        Añadir
      </button>
      <EntrySummary entries={entries} onChange={onChange} />
    </fieldset>
  );
}

function LabEntries({ label, onChange, suggestions, value }: EntryProps) {
  const suggestionId = `${useId()}-suggestions`;
  const [entry, setEntry] = useState({
    dateApproximate: "",
    name: "",
    referenceRange: "",
    source: "",
    unit: "",
    value: "",
  });
  const entries = isUnknownArray(value) ? value : [];
  return (
    <fieldset className="question-field entity-fieldset">
      <legend>{label}</legend>
      <div className="entity-grid">
        {Object.entries({
          name: "Valor analítico",
          value: "Resultado",
          unit: "Unidad",
          dateApproximate: "Fecha o rango aproximado",
          referenceRange: "Rango de referencia",
        }).map(([key, fieldLabel]) => (
          <label key={key}>
            <span>{fieldLabel}</span>
            <input
              list={key === "name" && suggestions.length ? suggestionId : undefined}
              maxLength={120}
              onChange={(event) =>
                setEntry((current) => ({ ...current, [key]: event.target.value }))
              }
              value={entry[key as keyof typeof entry]}
            />
          </label>
        ))}
        <label>
          <span>Fuente (opcional)</span>
          <select
            onChange={(event) =>
              setEntry((current) => ({ ...current, source: event.target.value }))
            }
            value={entry.source}
          >
            <option value="">Selecciona una opción</option>
            <option value="laboratory">Laboratorio</option>
            <option value="device">Dispositivo</option>
            <option value="self_reported">Dato comunicado por mí</option>
          </select>
        </label>
      </div>
      <SuggestionList id={suggestionId} options={suggestions} />
      <button
        className="secondary-button"
        disabled={
          !entry.name.trim() ||
          !entry.value.trim() ||
          !entry.unit.trim() ||
          !entry.dateApproximate.trim()
        }
        onClick={() => {
          const cleaned = Object.fromEntries(
            Object.entries(entry)
              .filter(([, item]) => item.trim())
              .map(([key, item]) => [key, item.trim()]),
          );
          onChange([...entries, cleaned]);
          setEntry({
            dateApproximate: "",
            name: "",
            referenceRange: "",
            source: "",
            unit: "",
            value: "",
          });
        }}
        type="button"
      >
        Añadir valor
      </button>
      <EntrySummary entries={entries} onChange={onChange} />
    </fieldset>
  );
}

type EntryProps = {
  label: string;
  onChange: (value: unknown) => void;
  suggestions: readonly Option[];
  value: unknown;
};

function SuggestionList({ id, options }: { id: string; options: readonly Option[] }) {
  if (!options.length) return null;
  return (
    <datalist id={id}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </datalist>
  );
}

function EntrySummary({
  entries,
  onChange,
}: {
  entries: unknown[];
  onChange: (value: unknown) => void;
}) {
  if (!entries.length) return null;
  return (
    <ul className="entry-list">
      {entries.map((entry, index) => {
        const name =
          typeof entry === "object" && entry !== null && "name" in entry
            ? String(entry.name)
            : `Elemento ${index + 1}`;
        return (
          <li key={`${name}-${index}`}>
            <span>{name}</span>
            <button
              className="text-button"
              onClick={() =>
                onChange(entries.filter((_, itemIndex) => itemIndex !== index))
              }
              type="button"
            >
              Quitar
            </button>
          </li>
        );
      })}
    </ul>
  );
}
