import json
import os

class Patient:
    def __init__(self, patient_id, name, age, notes=""):
        self.patient_id = patient_id
        self.name = name
        self.age = age
        self.notes = notes

class OperationStep:
    def __init__(self, description):
        self.description = description

class OperationPlan:
    def __init__(self, patient):
        self.patient = patient
        self.steps = []

    def add_step(self, step):
        self.steps.append(step)

    def summary(self):
        lines = [f"Operation plan for {self.patient.name} ({self.patient.age} years old):"]
        for i, step in enumerate(self.steps, 1):
            lines.append(f"  {i}. {step.description}")
        return "\n".join(lines)

    def to_dict(self):
        return {
            "patient_id": self.patient.patient_id,
            "name": self.patient.name,
            "age": self.patient.age,
            "notes": self.patient.notes,
            "steps": [s.description for s in self.steps],
        }

    def save(self, directory="data"):
        os.makedirs(directory, exist_ok=True)
        filepath = os.path.join(directory, f"{self.patient.patient_id}.json")
        with open(filepath, "w") as f:
            json.dump(self.to_dict(), f, indent=2)
        return filepath

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Maxillofacial Surgery Planner")
    parser.add_argument("patient_id")
    parser.add_argument("name")
    parser.add_argument("age", type=int)
    parser.add_argument("--notes", default="")
    parser.add_argument("steps", nargs='*', help="Steps for operation")
    parser.add_argument("--save", action="store_true", help="Save plan to file")
    args = parser.parse_args()

    patient = Patient(args.patient_id, args.name, args.age, notes=args.notes)
    plan = OperationPlan(patient)
    for s in args.steps:
        plan.add_step(OperationStep(s))

    if args.save:
        path = plan.save()
        print(f"Plan saved to {path}")
    print(plan.summary())
