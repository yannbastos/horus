# Horus App

## Structure

```text
src/
  Horus.Domain/          Business rules: entities, enums, value objects, domain exceptions
  Horus.Application/     Use cases: services, DTOs, and interfaces implemented by outer layers
  Horus.Infrastructure/  External concerns: database access and third-party integrations
  Horus.App/             Entry point: startup and dependency wiring
tests/
  Horus.UnitTests/       Unit tests, mirroring the Domain and Application folders
```

## Dependency rule

References point inward, so business rules never depend on a database or UI:

```text
Horus.App -> Horus.Infrastructure -> Horus.Application -> Horus.Domain
Horus.App -> Horus.Application
```

## Commands

Requires the .NET 10 SDK.

```powershell
dotnet build Horus.slnx
dotnet test Horus.slnx
dotnet run --project src/Horus.App
```
