$ErrorActionPreference = "Stop"

$cropRoot = "C:\Users\tharu\meditrack-ai\ocr-service\medicine-row-output-final"
$model = "qwen3-vl:4b-instruct"

$rows = Get-ChildItem $cropRoot -Directory -Filter "row_*" |
    Sort-Object Name

if (-not $rows) {
    throw "No medicine row folders found in: $cropRoot"
}

foreach ($row in $rows) {
    $imagePath = Join-Path $row.FullName "name.jpg"

    if (-not (Test-Path $imagePath)) {
        Write-Warning "Missing image: $imagePath"
        continue
    }

    $imageBase64 = [Convert]::ToBase64String(
        [IO.File]::ReadAllBytes($imagePath)
    )

    $prompt = @"
The image contains one cropped handwritten prescription medicine-name row.

Transcribe only what is visibly written. Do not guess from medical knowledge.
Return JSON only in this exact structure:

{
  "line_number": null,
  "dosage_form": null,
  "medicine_text": null,
  "strength": null,
  "quantity": null,
  "uncertain": true,
  "uncertain_characters": []
}

Rules:
- Preserve the visible spelling exactly.
- Do not correct or expand a medicine name.
- The circled number on the right is usually quantity.
- Use null when a field is not visible.
- Put unclear character alternatives in uncertain_characters.
- Never invent missing letters.
"@

    $body = @{
        model = $model
        stream = $false
        format = "json"
        keep_alive = "10m"
        options = @{
            temperature = 0
            num_predict = 160
        }
        messages = @(
            @{
                role = "user"
                content = $prompt
                images = @($imageBase64)
            }
        )
    } | ConvertTo-Json -Depth 10 -Compress

    $response = Invoke-RestMethod `
        -Uri "http://localhost:11434/api/chat" `
        -Method Post `
        -ContentType "application/json" `
        -Body $body `
        -TimeoutSec 600

    Write-Output ""
    Write-Output "===== $($row.Name) ====="
    Write-Output $response.message.content
}
