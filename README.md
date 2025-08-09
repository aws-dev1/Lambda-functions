This repo contains all the lambda functions code for Dynamic Event rendering 
1. Create Events which posts the forma data to dynamo db and respective images to s3 bucket folders
2. the second lambda lists all the events that are  stored in dynamo db table named "Events"   
3. the 3 rd lambda is used to get a particular eent id after matching  the entered events id with the entries in the db table 
