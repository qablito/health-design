import type { z } from "zod";
import { QuestionnaireAnswersSchema } from "./questionnaire.ts";
export declare const PLAN_SCHEMA_VERSION: 1;
export declare const CONTEXT_SOURCE_SCHEMA_VERSIONS: readonly [1, 2];
export declare const CONTEXT_NORMALIZATION_VERSION: "normalization-v1";
export declare const CONTEXT_CANONICALIZATION_VERSION: "canonical-json-v1";
export declare const PlanModuleSchema: z.ZodEnum<{
    nutrition: "nutrition";
    training: "training";
    hydration: "hydration";
    sleep: "sleep";
    mobility: "mobility";
    supplements: "supplements";
}>;
export declare const PlanVersionStatusSchema: z.ZodEnum<{
    active: "active";
    draft: "draft";
    archived: "archived";
}>;
export declare const PlanCompletenessSchema: z.ZodEnum<{
    complete: "complete";
    provisional: "provisional";
}>;
export declare const PlanValidationStatusSchema: z.ZodEnum<{
    invalid: "invalid";
    valid: "valid";
}>;
export declare const PlanCandidateStatusSchema: z.ZodEnum<{
    invalid: "invalid";
    pending: "pending";
    activated: "activated";
    discarded: "discarded";
}>;
export declare const ChangeImpactSchema: z.ZodEnum<{
    unaffected: "unaffected";
    module_only: "module_only";
    dependent_modules: "dependent_modules";
    structural: "structural";
}>;
export type PlanContextChange = Readonly<{
    affectedModules: Array<z.infer<typeof PlanModuleSchema>>;
    changedFields: string[];
    impact: z.infer<typeof ChangeImpactSchema>;
}>;
export declare function detectPlanContextChange(previous: z.infer<typeof QuestionnaireAnswersSchema>, current: z.infer<typeof QuestionnaireAnswersSchema>): PlanContextChange;
export declare const ContextSnapshotCreateRequestSchema: z.ZodObject<{
    expectedDraftVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const PlanGenerationRequestSchema: z.ZodObject<{
    contextSnapshotId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const PlanCandidateCreateRequestSchema: z.ZodObject<{
    baseVersionId: z.ZodUUID;
    contextSnapshotId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const ProductApplicationRequestSchema: z.ZodObject<{
    baseVersionId: z.ZodUUID;
    confirmationId: z.ZodUUID;
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
    selection: z.ZodObject<{
        dayIndex: z.ZodNumber;
        expectedCanonicalFoodKey: z.ZodString;
        foodIndex: z.ZodNumber;
        mealIndex: z.ZodNumber;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const PlanMutationRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<1>;
}, z.core.$strict>;
export declare const ContextSnapshotAckSchema: z.ZodObject<{
    canonicalizationVersion: z.ZodLiteral<"canonical-json-v1">;
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    createdAt: z.ZodISODateTime;
    effectiveAt: z.ZodISODateTime;
    id: z.ZodUUID;
    inputHash: z.ZodString;
    normalizationVersion: z.ZodLiteral<"normalization-v1">;
    profileId: z.ZodUUID;
    schemaVersion: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>;
    sourceDraftId: z.ZodUUID;
    sourceDraftVersion: z.ZodNumber;
}, z.core.$strict>;
export declare const ContextSnapshotInternalSchema: z.ZodObject<{
    canonicalizationVersion: z.ZodLiteral<"canonical-json-v1">;
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    createdAt: z.ZodISODateTime;
    effectiveAt: z.ZodISODateTime;
    id: z.ZodUUID;
    inputHash: z.ZodString;
    normalizationVersion: z.ZodLiteral<"normalization-v1">;
    profileId: z.ZodUUID;
    schemaVersion: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>]>;
    sourceDraftId: z.ZodUUID;
    sourceDraftVersion: z.ZodNumber;
    answers: z.ZodObject<{
        activeModules: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>>>;
        activityLevel: z.ZodOptional<z.ZodEnum<{
            moderate: "moderate";
            sedentary: "sedentary";
            light: "light";
            high: "high";
            very_high: "very_high";
        }>>;
        age: z.ZodOptional<z.ZodNumber>;
        conditions: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            note: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        compareSupermarkets: z.ZodOptional<z.ZodBoolean>;
        country: z.ZodOptional<z.ZodLiteral<"ES">>;
        currentSupplements: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            note: z.ZodOptional<z.ZodString>;
            aempsId: z.ZodOptional<z.ZodString>;
            dose: z.ZodOptional<z.ZodString>;
            frequency: z.ZodOptional<z.ZodString>;
            route: z.ZodOptional<z.ZodString>;
            schedule: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        dailySchedule: z.ZodOptional<z.ZodEnum<{
            regular: "regular";
            variable: "variable";
            shift_work: "shift_work";
        }>>;
        dietaryPattern: z.ZodOptional<z.ZodEnum<{
            omnivore: "omnivore";
            pescetarian: "pescetarian";
            vegetarian: "vegetarian";
            vegan: "vegan";
        }>>;
        excludedFoods: z.ZodOptional<z.ZodArray<z.ZodString>>;
        generatedTrainingDaysPerWeek: z.ZodOptional<z.ZodNumber>;
        generatedTrainingEquipment: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            none: "none";
            home_basic: "home_basic";
            full_gym: "full_gym";
        }>>>;
        generatedTrainingExperience: z.ZodOptional<z.ZodEnum<{
            advanced: "advanced";
            beginner: "beginner";
            intermediate: "intermediate";
        }>>;
        generatedTrainingOtherStyle: z.ZodOptional<z.ZodString>;
        generatedTrainingSessionMinutes: z.ZodOptional<z.ZodNumber>;
        generatedTrainingStyles: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            other: "other";
            bodyweight: "bodyweight";
            endurance: "endurance";
            functional_hiit: "functional_hiit";
            pilates: "pilates";
            sport_preparation: "sport_preparation";
            hypertrophy: "hypertrophy";
            strength: "strength";
            yoga: "yoga";
            strength_hypertrophy: "strength_hypertrophy";
            no_preference: "no_preference";
        }>>>;
        hasConditions: z.ZodOptional<z.ZodBoolean>;
        hasCurrentSupplements: z.ZodOptional<z.ZodBoolean>;
        hasLabValues: z.ZodOptional<z.ZodBoolean>;
        hasIndirectCalorimetry: z.ZodOptional<z.ZodBoolean>;
        hasMedications: z.ZodOptional<z.ZodBoolean>;
        habitualBeverages: z.ZodOptional<z.ZodArray<z.ZodString>>;
        habitualWaterMl: z.ZodOptional<z.ZodNumber>;
        heightCm: z.ZodOptional<z.ZodNumber>;
        indirectCalorimetryDate: z.ZodOptional<z.ZodISODate>;
        indirectCalorimetryRmrKcal: z.ZodOptional<z.ZodNumber>;
        indirectCalorimetrySource: z.ZodOptional<z.ZodEnum<{
            clinical_service: "clinical_service";
            sports_service: "sports_service";
            other: "other";
        }>>;
        hydrationAnchors: z.ZodOptional<z.ZodArray<z.ZodString>>;
        hydrationClimate: z.ZodOptional<z.ZodEnum<{
            variable: "variable";
            temperate: "temperate";
            hot: "hot";
            cold: "cold";
        }>>;
        hydrationFluidRestriction: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodEnum<{
            none: "none";
            declared: "declared";
            unknown: "unknown";
        }>]>>;
        hydrationReminders: z.ZodOptional<z.ZodBoolean>;
        hydrationSweat: z.ZodOptional<z.ZodEnum<{
            high: "high";
            unknown: "unknown";
            low: "low";
            medium: "medium";
        }>>;
        labValues: z.ZodOptional<z.ZodArray<z.ZodObject<{
            dateApproximate: z.ZodString;
            name: z.ZodString;
            referenceRange: z.ZodOptional<z.ZodString>;
            source: z.ZodOptional<z.ZodEnum<{
                device: "device";
                laboratory: "laboratory";
                self_reported: "self_reported";
            }>>;
            unit: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>>;
        mealsPerDay: z.ZodOptional<z.ZodNumber>;
        medications: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            note: z.ZodOptional<z.ZodString>;
            aempsId: z.ZodOptional<z.ZodString>;
            dose: z.ZodOptional<z.ZodString>;
            frequency: z.ZodOptional<z.ZodString>;
            route: z.ZodOptional<z.ZodString>;
            schedule: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        menopauseStage: z.ZodOptional<z.ZodEnum<{
            unknown: "unknown";
            not_applicable: "not_applicable";
            pre: "pre";
            peri: "peri";
            post: "post";
        }>>;
        mobilityAreas: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            hips: "hips";
            knees: "knees";
            ankles: "ankles";
            shoulders: "shoulders";
            neck: "neck";
            spine: "spine";
        }>>>;
        mobilityAnchors: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            evening: "evening";
            morning: "morning";
            daily_break: "daily_break";
            before_training: "before_training";
            after_training: "after_training";
        }>>>;
        mobilityDiscomfortDetails: z.ZodOptional<z.ZodArray<z.ZodString>>;
        mobilityDiscomfortStatus: z.ZodOptional<z.ZodEnum<{
            none: "none";
            declared: "declared";
            unknown: "unknown";
        }>>;
        mobilityMinutes: z.ZodOptional<z.ZodUnion<readonly [z.ZodLiteral<5>, z.ZodLiteral<10>, z.ZodLiteral<15>]>>;
        nutritionAllergies: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            note: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        nutritionAllergiesStatus: z.ZodOptional<z.ZodEnum<{
            none: "none";
            declared: "declared";
            unknown: "unknown";
        }>>;
        nutritionFoodAnxiety: z.ZodOptional<z.ZodEnum<{
            no: "no";
            sometimes: "sometimes";
            frequent: "frequent";
            prefer_not_to_say: "prefer_not_to_say";
        }>>;
        nutritionIntolerances: z.ZodOptional<z.ZodArray<z.ZodObject<{
            name: z.ZodString;
            note: z.ZodOptional<z.ZodString>;
            severity: z.ZodEnum<{
                mild: "mild";
                moderate: "moderate";
                severe: "severe";
            }>;
            toleratedAmount: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>>;
        nutritionIntolerancesStatus: z.ZodOptional<z.ZodEnum<{
            none: "none";
            declared: "declared";
            unknown: "unknown";
        }>>;
        nutritionMealAnchors: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            wake_up: "wake_up";
            mid_morning: "mid_morning";
            midday: "midday";
            afternoon: "afternoon";
            evening: "evening";
            pre_sleep: "pre_sleep";
            pre_training: "pre_training";
            post_training: "post_training";
        }>>>;
        nutritionMode: z.ZodOptional<z.ZodEnum<{
            simple: "simple";
            balanced: "balanced";
        }>>;
        ownTrainingDaysPerWeek: z.ZodOptional<z.ZodNumber>;
        ownTrainingAnchors: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            midday: "midday";
            afternoon: "afternoon";
            evening: "evening";
            variable: "variable";
            morning: "morning";
            early_morning: "early_morning";
        }>>>;
        ownTrainingIntensity: z.ZodOptional<z.ZodEnum<{
            moderate: "moderate";
            high: "high";
            variable: "variable";
            low: "low";
        }>>;
        ownTrainingSessionMinutes: z.ZodOptional<z.ZodNumber>;
        ownTrainingTypes: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            other: "other";
            bodyweight: "bodyweight";
            endurance: "endurance";
            functional_hiit: "functional_hiit";
            pilates: "pilates";
            sport_preparation: "sport_preparation";
            hypertrophy: "hypertrophy";
            strength: "strength";
            yoga: "yoga";
            strength_hypertrophy: "strength_hypertrophy";
            no_preference: "no_preference";
        }>>>;
        physiologicalSex: z.ZodOptional<z.ZodEnum<{
            prefer_not_to_say: "prefer_not_to_say";
            female: "female";
            male: "male";
            intersex: "intersex";
        }>>;
        pregnancyLactation: z.ZodOptional<z.ZodEnum<{
            none: "none";
            unknown: "unknown";
            not_applicable: "not_applicable";
            pregnant: "pregnant";
            lactating: "lactating";
            trying_to_conceive: "trying_to_conceive";
        }>>;
        preferredFoods: z.ZodOptional<z.ZodArray<z.ZodString>>;
        preferredSupermarket: z.ZodOptional<z.ZodString>;
        primaryObjective: z.ZodOptional<z.ZodEnum<{
            body_composition_lose_fat: "body_composition_lose_fat";
            body_composition_gain_muscle: "body_composition_gain_muscle";
            body_composition_recomposition: "body_composition_recomposition";
            body_composition_maintain: "body_composition_maintain";
            performance_strength: "performance_strength";
            performance_hypertrophy: "performance_hypertrophy";
            performance_endurance: "performance_endurance";
            performance_general_fitness: "performance_general_fitness";
            wellbeing_sleep: "wellbeing_sleep";
            wellbeing_energy: "wellbeing_energy";
            wellbeing_stress: "wellbeing_stress";
            wellbeing_healthy_habits: "wellbeing_healthy_habits";
        }>>;
        proteinPreference: z.ZodOptional<z.ZodEnum<{
            food_only: "food_only";
            usual_powder: "usual_powder";
            optional_substitution: "optional_substitution";
        }>>;
        secondaryObjectives: z.ZodOptional<z.ZodArray<z.ZodEnum<{
            body_composition_lose_fat: "body_composition_lose_fat";
            body_composition_gain_muscle: "body_composition_gain_muscle";
            body_composition_recomposition: "body_composition_recomposition";
            body_composition_maintain: "body_composition_maintain";
            performance_strength: "performance_strength";
            performance_hypertrophy: "performance_hypertrophy";
            performance_endurance: "performance_endurance";
            performance_general_fitness: "performance_general_fitness";
            wellbeing_sleep: "wellbeing_sleep";
            wellbeing_energy: "wellbeing_energy";
            wellbeing_stress: "wellbeing_stress";
            wellbeing_healthy_habits: "wellbeing_healthy_habits";
        }>>>;
        sleepBedTime: z.ZodOptional<z.ZodString>;
        sleepDeepMinutes: z.ZodOptional<z.ZodNumber>;
        sleepHours: z.ZodOptional<z.ZodNumber>;
        sleepLightMinutes: z.ZodOptional<z.ZodNumber>;
        sleepQuality: z.ZodOptional<z.ZodEnum<{
            very_poor: "very_poor";
            poor: "poor";
            fair: "fair";
            good: "good";
            very_good: "very_good";
        }>>;
        sleepRegularity: z.ZodOptional<z.ZodEnum<{
            regular: "regular";
            somewhat_variable: "somewhat_variable";
            very_variable: "very_variable";
        }>>;
        sleepRemMinutes: z.ZodOptional<z.ZodNumber>;
        sleepTracking: z.ZodOptional<z.ZodBoolean>;
        sleepWakeTime: z.ZodOptional<z.ZodString>;
        supplementGoals: z.ZodOptional<z.ZodArray<z.ZodString>>;
        supplementRecommendationPreference: z.ZodOptional<z.ZodEnum<{
            none: "none";
            only_deficiencies: "only_deficiencies";
            contextual: "contextual";
        }>>;
        targetWeightKg: z.ZodOptional<z.ZodNumber>;
        trainingLimitations: z.ZodOptional<z.ZodArray<z.ZodString>>;
        trainingLimitationsStatus: z.ZodOptional<z.ZodEnum<{
            none: "none";
            declared: "declared";
            unknown: "unknown";
        }>>;
        trainingMode: z.ZodOptional<z.ZodEnum<{
            none: "none";
            generated: "generated";
            own: "own";
        }>>;
        weightKg: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const PlanModuleResultInputSchema: z.ZodObject<{
    confidence: z.ZodEnum<{
        high: "high";
        unknown: "unknown";
        low: "low";
        medium: "medium";
    }>;
    module: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    status: z.ZodEnum<{
        provisional: "provisional";
        invalid: "invalid";
        valid: "valid";
        not_requested: "not_requested";
    }>;
    uncertainties: z.ZodArray<z.ZodUnknown>;
}, z.core.$strict>;
export declare const PlanSafetyFindingInputSchema: z.ZodObject<{
    actionLevel: z.ZodEnum<{
        information: "information";
        adjustment: "adjustment";
        priority_review: "priority_review";
        immediate_conservative: "immediate_conservative";
    }>;
    code: z.ZodString;
    evidenceRef: z.ZodString;
    messageKey: z.ZodString;
    module: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
    }>;
}, z.core.$strict>;
export declare const PlanEngineResultSchema: z.ZodObject<{
    canonicalizationVersion: z.ZodString;
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    engineVersion: z.ZodString;
    inputHash: z.ZodString;
    moduleResults: z.ZodArray<z.ZodObject<{
        confidence: z.ZodEnum<{
            high: "high";
            unknown: "unknown";
            low: "low";
            medium: "medium";
        }>;
        module: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        status: z.ZodEnum<{
            provisional: "provisional";
            invalid: "invalid";
            valid: "valid";
            not_requested: "not_requested";
        }>;
        uncertainties: z.ZodArray<z.ZodUnknown>;
    }, z.core.$strict>>;
    outputHash: z.ZodString;
    ruleSetRevisionId: z.ZodUUID;
    safetyFindings: z.ZodArray<z.ZodObject<{
        actionLevel: z.ZodEnum<{
            information: "information";
            adjustment: "adjustment";
            priority_review: "priority_review";
            immediate_conservative: "immediate_conservative";
        }>;
        code: z.ZodString;
        evidenceRef: z.ZodString;
        messageKey: z.ZodString;
        module: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>;
    }, z.core.$strict>>;
    sourceManifestId: z.ZodUUID;
    validation: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    validationStatus: z.ZodEnum<{
        invalid: "invalid";
        valid: "valid";
    }>;
}, z.core.$strict>;
export declare const PlanMutationAckSchema: z.ZodObject<{
    activatedAt: z.ZodNullable<z.ZodISODateTime>;
    activeVersionId: z.ZodNullable<z.ZodUUID>;
    aggregateVersion: z.ZodNumber;
    archivedAt: z.ZodNullable<z.ZodISODateTime>;
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    contextSnapshotId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    ordinal: z.ZodNumber;
    planId: z.ZodUUID;
    planVersionId: z.ZodUUID;
    status: z.ZodEnum<{
        active: "active";
        draft: "draft";
        archived: "archived";
    }>;
    validationStatus: z.ZodEnum<{
        invalid: "invalid";
        valid: "valid";
    }>;
}, z.core.$strict>;
export declare const PlanCandidateAckSchema: z.ZodObject<{
    activatedAt: z.ZodNullable<z.ZodISODateTime>;
    activeVersionId: z.ZodNullable<z.ZodUUID>;
    aggregateVersion: z.ZodNumber;
    archivedAt: z.ZodNullable<z.ZodISODateTime>;
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    contextSnapshotId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    ordinal: z.ZodNumber;
    planId: z.ZodUUID;
    planVersionId: z.ZodUUID;
    status: z.ZodEnum<{
        active: "active";
        draft: "draft";
        archived: "archived";
    }>;
    validationStatus: z.ZodEnum<{
        invalid: "invalid";
        valid: "valid";
    }>;
    baseVersionId: z.ZodUUID;
    candidateId: z.ZodUUID;
    candidateStatus: z.ZodEnum<{
        invalid: "invalid";
        pending: "pending";
        activated: "activated";
        discarded: "discarded";
    }>;
    changeEventId: z.ZodUUID;
    diff: z.ZodObject<{
        affectedModules: z.ZodArray<z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>>;
        changedFields: z.ZodArray<z.ZodString>;
    }, z.core.$strict>;
    impact: z.ZodEnum<{
        unaffected: "unaffected";
        module_only: "module_only";
        dependent_modules: "dependent_modules";
        structural: "structural";
    }>;
    resolvedAt: z.ZodNullable<z.ZodISODateTime>;
    validation: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strict>;
export declare const PlanVersionSchema: z.ZodObject<{
    activatedAt: z.ZodNullable<z.ZodISODateTime>;
    archivedAt: z.ZodNullable<z.ZodISODateTime>;
    canonicalizationVersion: z.ZodString;
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    contextSnapshotId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    engineVersion: z.ZodString;
    hashAlgorithm: z.ZodLiteral<"sha256">;
    id: z.ZodUUID;
    inputHash: z.ZodString;
    ordinal: z.ZodNumber;
    outputHash: z.ZodString;
    planId: z.ZodUUID;
    ruleSetRevisionId: z.ZodUUID;
    sourceManifestId: z.ZodUUID;
    status: z.ZodEnum<{
        active: "active";
        draft: "draft";
        archived: "archived";
    }>;
    validatedAt: z.ZodISODateTime;
    validation: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    validationStatus: z.ZodEnum<{
        invalid: "invalid";
        valid: "valid";
    }>;
}, z.core.$strict>;
export declare const PlanModuleResultSchema: z.ZodObject<{
    confidence: z.ZodEnum<{
        high: "high";
        unknown: "unknown";
        low: "low";
        medium: "medium";
    }>;
    module: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
    }>;
    payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    status: z.ZodEnum<{
        provisional: "provisional";
        invalid: "invalid";
        valid: "valid";
        not_requested: "not_requested";
    }>;
    uncertainties: z.ZodArray<z.ZodUnknown>;
    createdAt: z.ZodISODateTime;
    id: z.ZodUUID;
}, z.core.$strict>;
export declare const PlanSafetyFindingSchema: z.ZodObject<{
    actionLevel: z.ZodEnum<{
        information: "information";
        adjustment: "adjustment";
        priority_review: "priority_review";
        immediate_conservative: "immediate_conservative";
    }>;
    code: z.ZodString;
    evidenceRef: z.ZodString;
    messageKey: z.ZodString;
    module: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
    }>;
    createdAt: z.ZodISODateTime;
    id: z.ZodUUID;
}, z.core.$strict>;
export declare const PlanVersionDetailSchema: z.ZodObject<{
    activatedAt: z.ZodNullable<z.ZodISODateTime>;
    archivedAt: z.ZodNullable<z.ZodISODateTime>;
    canonicalizationVersion: z.ZodString;
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    contextSnapshotId: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    engineVersion: z.ZodString;
    hashAlgorithm: z.ZodLiteral<"sha256">;
    id: z.ZodUUID;
    inputHash: z.ZodString;
    ordinal: z.ZodNumber;
    outputHash: z.ZodString;
    planId: z.ZodUUID;
    ruleSetRevisionId: z.ZodUUID;
    sourceManifestId: z.ZodUUID;
    status: z.ZodEnum<{
        active: "active";
        draft: "draft";
        archived: "archived";
    }>;
    validatedAt: z.ZodISODateTime;
    validation: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    validationStatus: z.ZodEnum<{
        invalid: "invalid";
        valid: "valid";
    }>;
    moduleResults: z.ZodArray<z.ZodObject<{
        confidence: z.ZodEnum<{
            high: "high";
            unknown: "unknown";
            low: "low";
            medium: "medium";
        }>;
        module: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>;
        payload: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        status: z.ZodEnum<{
            provisional: "provisional";
            invalid: "invalid";
            valid: "valid";
            not_requested: "not_requested";
        }>;
        uncertainties: z.ZodArray<z.ZodUnknown>;
        createdAt: z.ZodISODateTime;
        id: z.ZodUUID;
    }, z.core.$strict>>;
    safetyFindings: z.ZodArray<z.ZodObject<{
        actionLevel: z.ZodEnum<{
            information: "information";
            adjustment: "adjustment";
            priority_review: "priority_review";
            immediate_conservative: "immediate_conservative";
        }>;
        code: z.ZodString;
        evidenceRef: z.ZodString;
        messageKey: z.ZodString;
        module: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>;
        createdAt: z.ZodISODateTime;
        id: z.ZodUUID;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const PlanHistorySchema: z.ZodObject<{
    activeVersionId: z.ZodNullable<z.ZodUUID>;
    aggregateVersion: z.ZodNumber;
    planId: z.ZodUUID;
    profileId: z.ZodUUID;
    versions: z.ZodArray<z.ZodObject<{
        activatedAt: z.ZodNullable<z.ZodISODateTime>;
        archivedAt: z.ZodNullable<z.ZodISODateTime>;
        canonicalizationVersion: z.ZodString;
        completeness: z.ZodEnum<{
            complete: "complete";
            provisional: "provisional";
        }>;
        contextSnapshotId: z.ZodUUID;
        createdAt: z.ZodISODateTime;
        engineVersion: z.ZodString;
        hashAlgorithm: z.ZodLiteral<"sha256">;
        id: z.ZodUUID;
        inputHash: z.ZodString;
        ordinal: z.ZodNumber;
        outputHash: z.ZodString;
        planId: z.ZodUUID;
        ruleSetRevisionId: z.ZodUUID;
        sourceManifestId: z.ZodUUID;
        status: z.ZodEnum<{
            active: "active";
            draft: "draft";
            archived: "archived";
        }>;
        validatedAt: z.ZodISODateTime;
        validation: z.ZodRecord<z.ZodString, z.ZodUnknown>;
        validationStatus: z.ZodEnum<{
            invalid: "invalid";
            valid: "valid";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type ContextSnapshotCreateRequest = z.infer<typeof ContextSnapshotCreateRequestSchema>;
export type ContextSnapshotAck = z.infer<typeof ContextSnapshotAckSchema>;
export type ContextSnapshotInternal = z.infer<typeof ContextSnapshotInternalSchema>;
export type PlanCandidateAck = z.infer<typeof PlanCandidateAckSchema>;
export type PlanCandidateCreateRequest = z.infer<typeof PlanCandidateCreateRequestSchema>;
export type ProductApplicationRequest = z.infer<typeof ProductApplicationRequestSchema>;
export type PlanEngineResult = z.infer<typeof PlanEngineResultSchema>;
export type PlanModuleResultInput = z.infer<typeof PlanModuleResultInputSchema>;
export type PlanGenerationRequest = z.infer<typeof PlanGenerationRequestSchema>;
export type PlanMutationRequest = z.infer<typeof PlanMutationRequestSchema>;
export type PlanMutationAck = z.infer<typeof PlanMutationAckSchema>;
export type PlanVersionDetail = z.infer<typeof PlanVersionDetailSchema>;
