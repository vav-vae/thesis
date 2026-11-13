# Ceiling reconstruction

Ceiling patchwork had two distinct causes: black colour padding leaking into
the multiband pyramid, and conflicting repeated-trim matches in the global
rotation fit. Warped colours now use reflected border conditions, while validity
masks continue to exclude pixels outside the source photographs.

The optional ceiling correction uses measured top-camera directions to choose
an overhead reference. It refits verified ceiling correspondences to a common
plane, selects the graph with strongest loop agreement, and removes sources
without independent cycle support. It requires a better fit than the rotation
model and at least 95% of the existing central ceiling coverage. An unsupported
plane leaves the global result intact and records its reason in
`camera_report.ceiling_alignment`.

Within this cap, source selection favours the reference photo's interior and
the centres of surrounding aligned photos. This avoids dividing a light fitting
or recessed trim between several slightly different views. The correction fades
between 58 and 66 degrees from the zenith; wall and floor rows remain unchanged.
Pyramid memory is bounded to the actual supported rows.

Regression tests cover false repeated-trim links, missing loop evidence, cap
coverage and isolation, unchanged masks, uniform-ceiling padding halos, and the
existing complete spherical sweep. Local real-photo checks use uncommitted
property photos; those fixtures are not included in the repository.
