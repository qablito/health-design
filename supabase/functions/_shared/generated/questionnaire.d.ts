import type { z } from "zod";
export declare const QuestionnaireModuleSchema: z.ZodEnum<{
    nutrition: "nutrition";
    training: "training";
    hydration: "hydration";
    sleep: "sleep";
    mobility: "mobility";
    supplements: "supplements";
}>;
export declare const QuestionnaireBlockIdSchema: z.ZodEnum<{
    nutrition: "nutrition";
    training: "training";
    hydration: "hydration";
    sleep: "sleep";
    mobility: "mobility";
    supplements: "supplements";
    core: "core";
    goals: "goals";
    modules: "modules";
    clinical: "clinical";
    labs: "labs";
    summary: "summary";
}>;
export declare const ObjectiveIdSchema: z.ZodEnum<{
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
}>;
type QuestionnaireBlockId = z.infer<typeof QuestionnaireBlockIdSchema>;
export declare const QuestionnaireAnswersSchema: z.ZodObject<{
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
type QuestionnaireAnswers = z.infer<typeof QuestionnaireAnswersSchema>;
declare const QuestionnaireUncertaintySchema: z.ZodObject<{
    affectedModules: z.ZodArray<z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
    }>>;
    answerId: z.ZodString;
    blockId: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
        core: "core";
        goals: "goals";
        modules: "modules";
        clinical: "clinical";
        labs: "labs";
        summary: "summary";
    }>;
    reason: z.ZodString;
}, z.core.$strict>;
declare const QuestionnaireHardErrorSchema: z.ZodObject<{
    answerId: z.ZodEnum<{
        activeModules: "activeModules";
        primaryObjective: "primaryObjective";
        secondaryObjectives: "secondaryObjectives";
    }>;
    code: z.ZodEnum<{
        modules_required: "modules_required";
        primary_objective_required: "primary_objective_required";
        secondary_objectives_limit: "secondary_objectives_limit";
    }>;
}, z.core.$strict>;
export type QuestionnaireEvaluation = {
    completeness: "complete" | "provisional";
    hardErrors: Array<z.infer<typeof QuestionnaireHardErrorSchema>>;
    uncertainties: Array<z.infer<typeof QuestionnaireUncertaintySchema>>;
};
export declare function evaluateQuestionnaire(answers: QuestionnaireAnswers): QuestionnaireEvaluation;
export declare const QuestionnaireDraftSaveRequestSchema: z.ZodObject<{
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
    confirmedBlockIds: z.ZodArray<z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
        core: "core";
        goals: "goals";
        modules: "modules";
        clinical: "clinical";
        labs: "labs";
        summary: "summary";
    }>>;
    currentBlockId: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
        core: "core";
        goals: "goals";
        modules: "modules";
        clinical: "clinical";
        labs: "labs";
        summary: "summary";
    }>;
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<2>;
}, z.core.$strict>;
export declare const QuestionnaireDraftSubmitRequestSchema: z.ZodObject<{
    expectedVersion: z.ZodNumber;
    schemaVersion: z.ZodLiteral<2>;
}, z.core.$strict>;
export declare const QuestionnaireDraftAckSchema: z.ZodObject<{
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    confirmedBlockIds: z.ZodArray<z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
        core: "core";
        goals: "goals";
        modules: "modules";
        clinical: "clinical";
        labs: "labs";
        summary: "summary";
    }>>;
    currentBlockId: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
        core: "core";
        goals: "goals";
        modules: "modules";
        clinical: "clinical";
        labs: "labs";
        summary: "summary";
    }>;
    hardErrors: z.ZodArray<z.ZodObject<{
        answerId: z.ZodEnum<{
            activeModules: "activeModules";
            primaryObjective: "primaryObjective";
            secondaryObjectives: "secondaryObjectives";
        }>;
        code: z.ZodEnum<{
            modules_required: "modules_required";
            primary_objective_required: "primary_objective_required";
            secondary_objectives_limit: "secondary_objectives_limit";
        }>;
    }, z.core.$strict>>;
    profileId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<2>;
    status: z.ZodEnum<{
        editing: "editing";
        submitted: "submitted";
    }>;
    uncertainties: z.ZodArray<z.ZodObject<{
        affectedModules: z.ZodArray<z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>>;
        answerId: z.ZodString;
        blockId: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
            core: "core";
            goals: "goals";
            modules: "modules";
            clinical: "clinical";
            labs: "labs";
            summary: "summary";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>>;
    updatedAt: z.ZodISODateTime;
    version: z.ZodNumber;
}, z.core.$strict>;
export declare const QuestionnaireDraftSchema: z.ZodObject<{
    completeness: z.ZodEnum<{
        complete: "complete";
        provisional: "provisional";
    }>;
    confirmedBlockIds: z.ZodArray<z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
        core: "core";
        goals: "goals";
        modules: "modules";
        clinical: "clinical";
        labs: "labs";
        summary: "summary";
    }>>;
    currentBlockId: z.ZodEnum<{
        nutrition: "nutrition";
        training: "training";
        hydration: "hydration";
        sleep: "sleep";
        mobility: "mobility";
        supplements: "supplements";
        core: "core";
        goals: "goals";
        modules: "modules";
        clinical: "clinical";
        labs: "labs";
        summary: "summary";
    }>;
    hardErrors: z.ZodArray<z.ZodObject<{
        answerId: z.ZodEnum<{
            activeModules: "activeModules";
            primaryObjective: "primaryObjective";
            secondaryObjectives: "secondaryObjectives";
        }>;
        code: z.ZodEnum<{
            modules_required: "modules_required";
            primary_objective_required: "primary_objective_required";
            secondary_objectives_limit: "secondary_objectives_limit";
        }>;
    }, z.core.$strict>>;
    profileId: z.ZodUUID;
    schemaVersion: z.ZodLiteral<2>;
    status: z.ZodEnum<{
        editing: "editing";
        submitted: "submitted";
    }>;
    uncertainties: z.ZodArray<z.ZodObject<{
        affectedModules: z.ZodArray<z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
        }>>;
        answerId: z.ZodString;
        blockId: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
            core: "core";
            goals: "goals";
            modules: "modules";
            clinical: "clinical";
            labs: "labs";
            summary: "summary";
        }>;
        reason: z.ZodString;
    }, z.core.$strict>>;
    updatedAt: z.ZodISODateTime;
    version: z.ZodNumber;
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
    id: z.ZodUUID;
}, z.core.$strict>;
export type QuestionnaireDraftSaveRequest = z.infer<typeof QuestionnaireDraftSaveRequestSchema>;
export type QuestionnaireDraftSubmitRequest = z.infer<typeof QuestionnaireDraftSubmitRequestSchema>;
export type QuestionnaireDraftAck = z.infer<typeof QuestionnaireDraftAckSchema>;
export type QuestionnaireDraft = z.infer<typeof QuestionnaireDraftSchema>;
type Option = {
    label: string;
    value: string;
};
type PublicQuestion = {
    blockId: QuestionnaireBlockId;
    id: keyof QuestionnaireAnswers;
    kind: "boolean" | "date" | "entities" | "multi" | "number" | "single" | "text" | "time";
    label: string;
    options?: Option[];
    visibleWhen?: {
        answerId: keyof QuestionnaireAnswers;
        includes: boolean | string | string[];
    };
};
export declare const QUESTIONNAIRE_PUBLIC_SCHEMA_V2: {
    readonly blocks: ({
        estimatedMinutes: number;
        id: "core";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "goals";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "modules";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "nutrition";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "training";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "hydration";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "sleep";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "mobility";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "supplements";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "clinical";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "labs";
        title: string;
    } | {
        estimatedMinutes: number;
        id: "summary";
        title: string;
    })[];
    readonly questions: PublicQuestion[];
    readonly schemaVersion: 2;
};
export declare const QuestionnairePublicSchemaResponseSchema: z.ZodObject<{
    blocks: z.ZodArray<z.ZodObject<{
        estimatedMinutes: z.ZodNumber;
        id: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
            core: "core";
            goals: "goals";
            modules: "modules";
            clinical: "clinical";
            labs: "labs";
            summary: "summary";
        }>;
        title: z.ZodString;
    }, z.core.$strict>>;
    questions: z.ZodArray<z.ZodObject<{
        blockId: z.ZodEnum<{
            nutrition: "nutrition";
            training: "training";
            hydration: "hydration";
            sleep: "sleep";
            mobility: "mobility";
            supplements: "supplements";
            core: "core";
            goals: "goals";
            modules: "modules";
            clinical: "clinical";
            labs: "labs";
            summary: "summary";
        }>;
        id: z.ZodString;
        kind: z.ZodEnum<{
            number: "number";
            boolean: "boolean";
            text: "text";
            date: "date";
            single: "single";
            time: "time";
            entities: "entities";
            multi: "multi";
        }>;
        label: z.ZodString;
        options: z.ZodOptional<z.ZodArray<z.ZodObject<{
            label: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>>;
        visibleWhen: z.ZodOptional<z.ZodObject<{
            answerId: z.ZodString;
            includes: z.ZodUnion<readonly [z.ZodBoolean, z.ZodString, z.ZodArray<z.ZodString>]>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    schemaVersion: z.ZodLiteral<2>;
}, z.core.$strict>;
export {};
