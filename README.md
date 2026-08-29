# Maxillofacial Surgery Planner

This repository contains a simple command-line application for planning maxillofacial surgery operations.

The main script is located in `src/planner.py`. It allows you to create a plan for a patient, specify steps of the operation and optionally save the plan to a JSON file.

## Usage

```
python src/planner.py PATIENT_ID NAME AGE --notes "some notes" \
    --save "Step 1" "Step 2" "Step 3"
```

The `--save` flag stores the plan to the `data/` directory as `PATIENT_ID.json`.
