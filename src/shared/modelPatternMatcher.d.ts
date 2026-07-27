export type ModelPatternMatcher = {
    test(value: string): boolean;
};
export declare function isModelRegexPattern(pattern: string): boolean;
export declare function isExactModelPattern(pattern: string): boolean;
export declare function parseModelRegexPattern(pattern: string): {
    regex: ModelPatternMatcher | null;
    error: string | null;
};
export declare function matchesModelPattern(model: string, pattern: string): boolean;
