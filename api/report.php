<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content=
"width=device-width, initial-scale=1.0">
    <title>Convert JSON to Excel</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
</head>

<body>
    <h1>GeeksForGeeks</h1>
    <h5>Approach 1: Using SheetJS (xlsx)</h5>
<input type="text" name="" value="" placeholder="เริ่ม">-
<input type="text" name="" value="" placeholder="ถึง">
<input type="text" name="" value="" placeholder="ปี">
    <button id="export-btn">สรุปรายงาน</button>

    <script>
        // Sample JSON data
        var data_arr = [];
        const jsonData = data_arr;

        // Function to export JSON data to Excel
        function exportJsonToExcel() {
            // Create a new workbook
            const workbook = XLSX.utils.book_new();

            // Convert JSON data to a worksheet
            const worksheet = XLSX.utils.json_to_sheet(jsonData);

            // Append the worksheet to the workbook
            XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

            // Export the workbook as an Excel file
            XLSX.writeFile(workbook, "data.xlsx");
        }

        // Event listener for the export button
        document.getElementById("export-btn").addEventListener("click", exportJsonToExcel);
    </script>

</body>

</html>
