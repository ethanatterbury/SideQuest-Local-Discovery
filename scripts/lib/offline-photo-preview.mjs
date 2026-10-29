/** Add image analysis to explicit maintenance without importing it in the app. */
export function withLocalPhotoReview(resolvePreview, review, now = Date.now) {
  return async (query, options = {}) => {
    const started = now();
    const response = await resolvePreview(query, {
      ...options,
      collectReviewCandidates: true,
    });
    if (response.image || !response.result?.reviewCandidates?.length)
      return response;
    const remaining = Math.max(
      0,
      (options.timeoutMs ?? 12000) - (now() - started),
    );
    let analysis;
    try {
      analysis =
        remaining > 0
          ? await review(query, response.result, {
              ...(options.signal ? { signal: options.signal } : {}),
              timeoutMs: remaining,
              maxCandidates: 2,
            })
          : {
              image: null,
              diagnostics: {
                status: "timeout",
                modelStatus: "not-loaded",
                reason: "maintenance-deadline",
                attempted: 0,
                considered: 0,
              },
            };
    } catch {
      analysis = {
        image: null,
        diagnostics: {
          status: "unavailable",
          modelStatus: "unavailable",
          reason: "local-review-unavailable",
          attempted: 0,
          considered: 0,
        },
      };
    }
    return {
      ...response,
      image: analysis.image ?? null,
      retryable:
        response.retryable ||
        ["unavailable", "timeout"].includes(analysis.diagnostics.status),
      result: { ...response.result, vision: analysis.diagnostics },
    };
  };
}
